import type { ItemSelector } from "./ai/decision.js";
import type { AvailabilityProvider, NotificationProvider, ProductCatalogProvider, WishlistProvider } from "./integrations/providers.js";
import type { Logger } from "./logging.js";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export class WishlistMonitor {
  public constructor(
    private readonly wishlist: WishlistProvider,
    private readonly catalog: ProductCatalogProvider,
    private readonly availability: AvailabilityProvider,
    private readonly selector: ItemSelector,
    private readonly notification: NotificationProvider,
    private readonly databasePath: string,
    private readonly logger: Logger
  ) {}

  public initialize(): void {
    mkdirSync(dirname(this.databasePath), { recursive: true });
    using database = new DatabaseSync(this.databasePath);
    database.exec(`CREATE TABLE IF NOT EXISTS availability_state (
      product_identifier TEXT PRIMARY KEY,
      available INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )`);
  }

  public async runOnce(now = new Date()): Promise<void> {
    try {
      const items = await this.wishlist.list();
      for (const item of items) {
        if (!item.enabled) continue;
        try {
          const candidates = this.catalog.lookupProducts(item.productIdentifier);
          const selectedItem = this.selector.select(item.productIdentifier, item.productName, candidates);
          if (!selectedItem) continue;
          
          const current = this.availability.getAvailability(selectedItem.sku);
          if (!current) continue;

          const isAvailable = current.available && current.availableQuantity > 0;
          const wasAvailable = this.getPreviousState(item.productIdentifier);

          if (isAvailable && !wasAvailable) {
            const priceStr = (selectedItem.pricePaise / 100).toFixed(2);
            const message = `Product Available: ${selectedItem.name} (${item.productIdentifier})\nPrice: ₹${priceStr}\nStatus: Available (${current.availableQuantity} in stock)\nTime: ${now.toISOString()}`;
            try {
              await this.notification.notify(message);
            } catch (err) {
              this.logger.error("Failed to send notification", { error: err instanceof Error ? err.message : String(err) });
              continue; // Do not update state if notification fails so we can retry next time
            }
          }

          if (isAvailable !== wasAvailable) {
            this.setPreviousState(item.productIdentifier, isAvailable, now);
          }
        } catch (error) {
          this.logger.error("Monitor failed to process item", { productIdentifier: item.productIdentifier, error: error instanceof Error ? error.message : String(error) });
        }
      }
    } catch (error) {
      this.logger.error("Monitor failed to run", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private getPreviousState(productIdentifier: string): boolean {
    using database = new DatabaseSync(this.databasePath);
    const row = database.prepare("SELECT available FROM availability_state WHERE product_identifier = ?").get(productIdentifier) as { available: number } | undefined;
    return row !== undefined && row.available === 1;
  }

  private setPreviousState(productIdentifier: string, available: boolean, timestamp: Date): void {
    using database = new DatabaseSync(this.databasePath);
    database.prepare(`INSERT INTO availability_state (product_identifier, available, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(product_identifier) DO UPDATE SET
      available = excluded.available,
      updated_at = excluded.updated_at`).run(productIdentifier, Number(available), timestamp.toISOString());
  }
}
