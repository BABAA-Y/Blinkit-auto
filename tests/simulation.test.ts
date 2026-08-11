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
    expect(results).toHaveLength(3);
    
    // Check SQLite
    using database = new DatabaseSync(databasePath);
    const count = (database.prepare("SELECT COUNT(*) AS count FROM mock_catalog").get() as { count: number }).count;
    expect(count).toBe(3);
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
});
