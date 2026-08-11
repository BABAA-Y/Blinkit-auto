import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { CatalogItem } from "../models.js";
import type { CatalogAvailabilityProvider, ProductAvailability } from "./providers.js";

/** Offline catalog implementation for safe local development and tests. It never contacts Blinkit. */
export class MockBlinkitCatalog implements CatalogAvailabilityProvider {
  private readonly defaultItems: readonly CatalogItem[] = [
    { sku: "mock-banana-1", name: "Bananas (6 pcs)", pricePaise: 4500, available: true, availableQuantity: 10 },
    { sku: "mock-milk-1", name: "Milk (1 L)", pricePaise: 6800, available: true, availableQuantity: 5 },
    { sku: "mock-milk-2", name: "Organic Milk (1 L)", pricePaise: 16000, available: false, availableQuantity: 0 },
  ];
  private items: CatalogItem[] = [...this.defaultItems];

  public constructor(private readonly databasePath?: string) {
    if (this.databasePath) {
      mkdirSync(dirname(this.databasePath), { recursive: true });
      using database = new DatabaseSync(this.databasePath);
      database.exec(`CREATE TABLE IF NOT EXISTS mock_catalog (
        sku TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        price_paise INTEGER NOT NULL,
        available INTEGER NOT NULL,
        available_quantity INTEGER NOT NULL
      )`);
      const count = (database.prepare("SELECT COUNT(*) AS count FROM mock_catalog").get() as { count: number }).count;
      if (count === 0) {
        const stmt = database.prepare(`INSERT INTO mock_catalog (sku, name, price_paise, available, available_quantity) VALUES (?, ?, ?, ?, ?)`);
        for (const item of this.defaultItems) stmt.run(item.sku, item.name, item.pricePaise, Number(item.available), item.availableQuantity);
      }
    }
  }

  public setAvailability(sku: string, available: boolean, quantity: number): boolean {
    if (this.databasePath) {
      using database = new DatabaseSync(this.databasePath);
      const result = database.prepare("UPDATE mock_catalog SET available = ?, available_quantity = ? WHERE sku = ?").run(Number(available), quantity, sku);
      return result.changes > 0;
    } else {
      const item = this.items.find(i => i.sku === sku);
      if (item) {
        item.available = available;
        item.availableQuantity = quantity;
        return true;
      }
      return false;
    }
  }

  private getItems(): CatalogItem[] {
    if (this.databasePath) {
      using database = new DatabaseSync(this.databasePath);
      const rows = database.prepare("SELECT sku, name, price_paise, available, available_quantity FROM mock_catalog").all() as any[];
      return rows.map(r => ({
        sku: r.sku, name: r.name, pricePaise: r.price_paise, available: r.available === 1, availableQuantity: r.available_quantity
      }));
    }
    return this.items;
  }

  public lookupProducts(query: string): readonly CatalogItem[] {
    const normalized = query.toLocaleLowerCase();
    return this.getItems().filter((item) =>
      item.sku.toLocaleLowerCase().includes(normalized) || item.name.toLocaleLowerCase().includes(normalized),
    );
  }

  public getAvailability(productIdentifier: string): ProductAvailability | undefined {
    const item = this.getItems().find((candidate) => candidate.sku === productIdentifier);
    return item === undefined ? undefined : {
      productIdentifier: item.sku, available: item.available, availableQuantity: item.availableQuantity,
    };
  }
}
