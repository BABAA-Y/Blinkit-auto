import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockBlinkitCatalog } from "../src/integrations/blinkit.js";
import { DatabaseSync } from "node:sqlite";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe("MockBlinkitCatalog Simulation", () => {
  it("initializes SQLite with default items", () => {
    const directory = mkdtempSync(join(tmpdir(), "blinkit-auto-"));
    directories.push(directory);
    const databasePath = join(directory, "test.sqlite3");

    const catalog = new MockBlinkitCatalog(databasePath);
    const results = catalog.lookupProducts("");
    expect(results).toHaveLength(4);
    
    // Check SQLite
    using database = new DatabaseSync(databasePath);
    const count = (database.prepare("SELECT COUNT(*) AS count FROM mock_catalog").get() as { count: number }).count;
    expect(count).toBe(4);
  });

  it("updates availability and quantity in SQLite", () => {
    const directory = mkdtempSync(join(tmpdir(), "blinkit-auto-"));
    directories.push(directory);
    const databasePath = join(directory, "test.sqlite3");

    const catalog = new MockBlinkitCatalog(databasePath);
    
    expect(catalog.getAvailability("mock-banana-1")?.available).toBe(true);
    
    const changed = catalog.setAvailability("mock-banana-1", false, 0);
    expect(changed).toBe(true);
    
    expect(catalog.getAvailability("mock-banana-1")?.available).toBe(false);
    expect(catalog.getAvailability("mock-banana-1")?.availableQuantity).toBe(0);

    // Verify it loads correctly in a new instance (persistence)
    const newCatalog = new MockBlinkitCatalog(databasePath);
    expect(newCatalog.getAvailability("mock-banana-1")?.available).toBe(false);
  });

  it("fails to update non-existent sku", () => {
    const directory = mkdtempSync(join(tmpdir(), "blinkit-auto-"));
    directories.push(directory);
    const databasePath = join(directory, "test.sqlite3");

    const catalog = new MockBlinkitCatalog(databasePath);
    
    const changed = catalog.setAvailability("invalid-sku", true, 10);
    expect(changed).toBe(false);
  });

  it("adds new missing default items to an existing mock database safely", () => {
    const directory = mkdtempSync(join(tmpdir(), "blinkit-auto-"));
    directories.push(directory);
    const databasePath = join(directory, "test.sqlite3");

    // Manually create the old 3-item database state
    using db = new DatabaseSync(databasePath);
    db.exec(`CREATE TABLE IF NOT EXISTS mock_catalog (
      sku TEXT,
      pincode TEXT,
      name TEXT NOT NULL,
      price_paise INTEGER NOT NULL,
      available INTEGER NOT NULL,
      available_quantity INTEGER NOT NULL,
      PRIMARY KEY (sku, pincode)
    )`);
    db.prepare(`INSERT INTO mock_catalog (sku, pincode, name, price_paise, available, available_quantity) VALUES ('old-banana', '*', 'Banana', 4500, 1, 10)`).run();
    db.prepare(`INSERT INTO mock_catalog (sku, pincode, name, price_paise, available, available_quantity) VALUES ('old-milk', '*', 'Milk', 6800, 0, 0)`).run();
    
    // Total 2 existing random items. Now we initialize MockBlinkitCatalog on it.
    const catalog = new MockBlinkitCatalog(databasePath);
    
    // It should have inserted all missing default items, so total = 2 (old) + 4 (default) = 6
    const count = (db.prepare("SELECT COUNT(*) AS count FROM mock_catalog").get() as { count: number }).count;
    expect(count).toBe(6);

    // Verify hot wheels was added
    expect(catalog.getAvailability("mock-hotwheels-chevy")?.available).toBe(true);
  });

  it("does not overwrite existing item state on initialization", () => {
    const directory = mkdtempSync(join(tmpdir(), "blinkit-auto-"));
    directories.push(directory);
    const databasePath = join(directory, "test.sqlite3");

    // Start a fresh DB
    const catalog = new MockBlinkitCatalog(databasePath);
    // Change banana state (which is a default item)
    catalog.setAvailability("mock-banana-1", false, 0, "*");
    
    // Make sure it is saved
    using db = new DatabaseSync(databasePath);
    db.exec(`UPDATE mock_catalog SET price_paise = 99999 WHERE sku = 'mock-banana-1'`);

    // Now reload MockBlinkitCatalog
    const reloaded = new MockBlinkitCatalog(databasePath);
    
    // State should NOT be overwritten by the default values
    expect(reloaded.getAvailability("mock-banana-1")?.available).toBe(false);
    expect(reloaded.getAvailability("mock-banana-1")?.availableQuantity).toBe(0);
    
    const bananas = reloaded.lookupProducts("banana");
    expect(bananas[0]?.pricePaise).toBe(99999);
  });
});
