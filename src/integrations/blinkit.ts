import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { CatalogItem, DeliveryLocation } from "../models.js";
import type { CatalogAvailabilityProvider, ProductAvailability } from "./providers.js";

/** Offline catalog implementation for safe local development and tests. It never contacts Blinkit. */
export class MockBlinkitCatalog implements CatalogAvailabilityProvider {
  private readonly defaultItems: readonly (CatalogItem & { pincode: string })[] = [
    { sku: "mock-banana-1", pincode: "*", name: "Bananas (6 pcs)", pricePaise: 4500, available: true, availableQuantity: 10 },
    { sku: "mock-milk-1", pincode: "*", name: "Milk (1 L)", pricePaise: 6800, available: true, availableQuantity: 5 },
    { sku: "mock-milk-2", pincode: "*", name: "Organic Milk (1 L)", pricePaise: 16000, available: false, availableQuantity: 0 },
    { sku: "mock-hotwheels-chevy", pincode: "*", name: "Hot Wheels '63 Chevy II Die Cast Car", pricePaise: 17900, available: true, availableQuantity: 5 },
  ];
  private items: (CatalogItem & { pincode: string })[] = [...this.defaultItems];

  public constructor(private readonly databasePath?: string) {
    if (this.databasePath) {
      mkdirSync(dirname(this.databasePath), { recursive: true });
      using database = new DatabaseSync(this.databasePath);
      const info = database.prepare("PRAGMA table_info(mock_catalog)").all() as any[];
      if (info.length > 0 && !info.some(c => c.name === "pincode")) {
        database.exec("DROP TABLE mock_catalog");
      }
      database.exec(`CREATE TABLE IF NOT EXISTS mock_catalog (
        sku TEXT,
        pincode TEXT,
        name TEXT NOT NULL,
        price_paise INTEGER NOT NULL,
        available INTEGER NOT NULL,
        available_quantity INTEGER NOT NULL,
        PRIMARY KEY (sku, pincode)
      )`);
      const stmt = database.prepare(`INSERT OR IGNORE INTO mock_catalog (sku, pincode, name, price_paise, available, available_quantity) VALUES (?, ?, ?, ?, ?, ?)`);
      for (const item of this.defaultItems) stmt.run(item.sku, item.pincode, item.name, item.pricePaise, Number(item.available), item.availableQuantity);
    }
  }

  public setAvailability(sku: string, available: boolean, quantity: number, pincode: string = "*"): boolean {
    if (this.databasePath) {
      using database = new DatabaseSync(this.databasePath);
      let existing = database.prepare("SELECT name, price_paise FROM mock_catalog WHERE sku = ? LIMIT 1").get(sku) as any;
      if (!existing) return false;
      
      database.prepare(`
        INSERT INTO mock_catalog (sku, pincode, name, price_paise, available, available_quantity)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(sku, pincode) DO UPDATE SET
        available = excluded.available,
        available_quantity = excluded.available_quantity
      `).run(sku, pincode, existing.name, existing.price_paise, Number(available), quantity);
      return true;
    } else {
      let item = this.items.find(i => i.sku === sku && i.pincode === pincode);
      if (item) {
        item.available = available;
        item.availableQuantity = quantity;
        return true;
      } else {
        const baseItem = this.items.find(i => i.sku === sku);
        if (baseItem) {
          this.items.push({ ...baseItem, pincode, available, availableQuantity: quantity });
          return true;
        }
      }
      return false;
    }
  }

  private getItems(pincode: string = "*"): CatalogItem[] {
    if (this.databasePath) {
      using database = new DatabaseSync(this.databasePath);
      const rows = database.prepare(`
        SELECT sku, name, price_paise, available, available_quantity, pincode 
        FROM mock_catalog 
        WHERE pincode = ? OR pincode = '*'
        ORDER BY pincode DESC
      `).all(pincode) as any[];
      
      const map = new Map<string, CatalogItem>();
      for (const r of rows) {
        if (!map.has(r.sku)) {
          map.set(r.sku, { sku: r.sku, name: r.name, pricePaise: r.price_paise, available: r.available === 1, availableQuantity: r.available_quantity });
        }
      }
      return Array.from(map.values());
    }
    
    const map = new Map<string, CatalogItem>();
    const sorted = [...this.items].sort((a, b) => (a.pincode === pincode ? -1 : b.pincode === pincode ? 1 : 0));
    for (const item of sorted) {
      if ((item.pincode === pincode || item.pincode === "*") && !map.has(item.sku)) {
        map.set(item.sku, item);
      }
    }
    return Array.from(map.values());
  }

  public lookupProducts(query: string): readonly CatalogItem[] {
    const normalized = query.toLocaleLowerCase();
    return this.getItems("*").filter((item) =>
      item.sku.toLocaleLowerCase().includes(normalized) || item.name.toLocaleLowerCase().includes(normalized),
    );
  }

  public searchProducts(query: string, location?: DeliveryLocation): readonly CatalogItem[] {
    const normalized = query.toLocaleLowerCase();
    return this.getItems(location?.pincode ?? "*").filter((item) =>
      item.sku.toLocaleLowerCase().includes(normalized) || item.name.toLocaleLowerCase().includes(normalized),
    );
  }

  public getAvailability(productIdentifier: string, location?: DeliveryLocation): ProductAvailability | undefined {
    const items = this.getItems(location?.pincode ?? "*");
    const item = items.find((candidate) => candidate.sku === productIdentifier);
    return item === undefined ? undefined : {
      productIdentifier: item.sku, available: item.available, availableQuantity: item.availableQuantity,
    };
  }
}
