import { buildSearchQuery, type ItemSelector } from "./ai/decision.js";
import type { AvailabilityProvider, NotificationProvider, ProductSearchProvider, WishlistProvider } from "./integrations/providers.js";
import type { Logger } from "./logging.js";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { LocationRepository } from "./storage/location.js";
import { formatTimestamp } from "./ui/formatting.js";

export class WishlistMonitor {
  public constructor(
    private readonly wishlist: WishlistProvider,
    private readonly catalog: ProductSearchProvider,
    private readonly availability: AvailabilityProvider,
    private readonly selector: ItemSelector,
    private readonly notification: NotificationProvider,
    private readonly location: LocationRepository,
    private readonly databasePath: string,
    private readonly logger: Logger
  ) {}

  public initialize(): void {
    mkdirSync(dirname(this.databasePath), { recursive: true });
    using database = new DatabaseSync(this.databasePath);
    const info = database.prepare("PRAGMA table_info(availability_state)").all() as any[];
    if (info.length > 0 && !info.some(c => c.name === "wishlist_id")) {
      database.exec("DROP TABLE availability_state");
    }
    database.exec(`CREATE TABLE IF NOT EXISTS availability_state (
      wishlist_id TEXT,
      pincode TEXT,
      available INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (wishlist_id, pincode)
    )`);
  }

  public async runOnce(now = new Date()): Promise<void> {
    try {
      const deliveryLocation = this.location.get();
      const currentPincode = deliveryLocation?.pincode ?? "*";
      
      const items = await this.wishlist.list();
      for (const item of items) {
        if (!item.enabled) continue;
        try {
          const searchQuery = buildSearchQuery(item);
          const candidates = await this.catalog.searchProducts(searchQuery, deliveryLocation);
          const selectedItem = this.selector.select(item, candidates);
          if (!selectedItem) continue;
          
          const current = await this.availability.getAvailability(selectedItem.sku, deliveryLocation);
          if (!current) continue;

          const isAvailable = current.available && current.availableQuantity >= item.quantity && selectedItem.pricePaise <= item.maximumUnitPricePaise;
          const wasAvailable = this.getPreviousState(item.id, currentPincode);

          if (isAvailable && !wasAvailable) {
            const priceStr = (selectedItem.pricePaise / 100).toFixed(2);
            const locationStr = deliveryLocation ? `\nLocation: ${deliveryLocation.pincode}` : "";
            const message = `Product Available: ${selectedItem.name} (${selectedItem.sku})\nPrice: ₹${priceStr}\nStatus: Available (${current.availableQuantity} in stock)${locationStr}\nTime: ${formatTimestamp(now)}`;
            try {
              await this.notification.notify(message);
            } catch (err) {
              this.logger.error("Failed to send notification", { error: err instanceof Error ? err.message : String(err) });
              continue; // Do not update state if notification fails so we can retry next time
            }
          }

          if (isAvailable !== wasAvailable) {
            this.setPreviousState(item.id, currentPincode, isAvailable, now);
          }
        } catch (error) {
          this.logger.error("Monitor failed to process item", { wishlistId: item.id, error: error instanceof Error ? error.message : String(error) });
        }
      }
    } catch (error) {
      this.logger.error("Monitor failed to run", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private getPreviousState(wishlistId: string, pincode: string): boolean {
    using database = new DatabaseSync(this.databasePath);
    const row = database.prepare("SELECT available FROM availability_state WHERE wishlist_id = ? AND pincode = ?").get(wishlistId, pincode) as { available: number } | undefined;
    return row !== undefined && row.available === 1;
  }

  private setPreviousState(wishlistId: string, pincode: string, available: boolean, timestamp: Date): void {
    using database = new DatabaseSync(this.databasePath);
    database.prepare(`INSERT INTO availability_state (wishlist_id, pincode, available, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(wishlist_id, pincode) DO UPDATE SET
      available = excluded.available,
      updated_at = excluded.updated_at`).run(wishlistId, pincode, Number(available), timestamp.toISOString());
  }
}
