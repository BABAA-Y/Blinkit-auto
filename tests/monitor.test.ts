import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WishlistMonitor } from "../src/monitor.js";
import { SimpleItemSelector } from "../src/ai/decision.js";
import { MockNotificationProvider } from "../src/notifications/mock.js";
import type { AvailabilityProvider, ProductCatalogProvider, WishlistProvider } from "../src/integrations/providers.js";
import type { Logger } from "../src/logging.js";
import type { CatalogItem, WishlistItem } from "../src/models.js";
import { DatabaseSync } from "node:sqlite";

const directories: string[] = [];
const logger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

function monitorSetup(items: CatalogItem[], wishlistItems: WishlistItem[]) {
  const directory = mkdtempSync(join(tmpdir(), "blinkit-auto-"));
  directories.push(directory);
  const databasePath = join(directory, "test.sqlite3");

  const wishlist: WishlistProvider = { list: () => wishlistItems };
  const catalog: ProductCatalogProvider = { lookupProducts: (query) => items.filter((item) => item.sku === query) };
  const availability: AvailabilityProvider = {
    getAvailability: (productIdentifier) => {
      const found = items.find((candidate) => candidate.sku === productIdentifier);
      return found === undefined ? undefined : { productIdentifier, available: found.available, availableQuantity: found.availableQuantity };
    }
  };
  const notification = new MockNotificationProvider(logger);
  
  const monitor = new WishlistMonitor(wishlist, catalog, availability, new SimpleItemSelector(), notification, databasePath, logger);
  monitor.initialize();

  return { monitor, notification, databasePath };
}

function wItem(id: string, productIdentifier: string, enabled = true): WishlistItem {
  return { id, productIdentifier, productName: "Product", quantity: 1, maximumUnitPricePaise: 10000, enabled, cooldownMinutes: 0 };
}

function cItem(sku: string, available: boolean, availableQuantity: number): CatalogItem {
  return { sku, name: "Product", pricePaise: 5000, available, availableQuantity };
}

describe("WishlistMonitor", () => {
  it("unavailable item does not trigger notification", async () => {
    const { monitor, notification } = monitorSetup([cItem("p1", false, 0)], [wItem("w1", "p1")]);
    await monitor.runOnce();
    expect(notification.messages).toHaveLength(0);
  });

  it("unavailable -> available triggers notification", async () => {
    const items = [cItem("p1", false, 0)];
    const { monitor, notification } = monitorSetup(items, [wItem("w1", "p1")]);
    await monitor.runOnce(); // state: unavailable
    expect(notification.messages).toHaveLength(0);

    items[0]!.available = true;
    items[0]!.availableQuantity = 5;
    await monitor.runOnce(); // state: available
    expect(notification.messages).toHaveLength(1);
    expect(notification.messages[0]).toMatch(/Product Available/);
  });

  it("available item triggers notification on first run", async () => {
    const { monitor, notification } = monitorSetup([cItem("p1", true, 5)], [wItem("w1", "p1")]);
    await monitor.runOnce();
    expect(notification.messages).toHaveLength(1);
  });

  it("available -> available does NOT trigger another notification", async () => {
    const { monitor, notification } = monitorSetup([cItem("p1", true, 5)], [wItem("w1", "p1")]);
    await monitor.runOnce();
    expect(notification.messages).toHaveLength(1);
    await monitor.runOnce();
    expect(notification.messages).toHaveLength(1);
  });

  it("available -> unavailable -> available triggers a new notification", async () => {
    const items = [cItem("p1", true, 5)];
    const { monitor, notification } = monitorSetup(items, [wItem("w1", "p1")]);
    await monitor.runOnce();
    expect(notification.messages).toHaveLength(1);

    items[0]!.available = false;
    items[0]!.availableQuantity = 0;
    await monitor.runOnce(); // state becomes unavailable
    expect(notification.messages).toHaveLength(1);

    items[0]!.available = true;
    items[0]!.availableQuantity = 5;
    await monitor.runOnce(); // state becomes available again
    expect(notification.messages).toHaveLength(2);
  });

  it("multiple wishlist items", async () => {
    const { monitor, notification } = monitorSetup(
      [cItem("p1", true, 5), cItem("p2", true, 2)],
      [wItem("w1", "p1"), wItem("w2", "p2", false)] // p2 is disabled
    );
    await monitor.runOnce();
    expect(notification.messages).toHaveLength(1); // only p1 notifies
  });

  it("notification failure does not crash the monitor", async () => {
    const { monitor, notification } = monitorSetup([cItem("p1", true, 5)], [wItem("w1", "p1")]);
    notification.shouldFail = true;
    await expect(monitor.runOnce()).resolves.toBeUndefined();
    
    // next run should try again since state shouldn't be updated
    notification.shouldFail = false;
    await monitor.runOnce();
    expect(notification.messages).toHaveLength(1);
  });

  it("missing/invalid provider data is ignored", async () => {
    const { monitor, notification } = monitorSetup([], [wItem("w1", "invalid")]);
    await expect(monitor.runOnce()).resolves.toBeUndefined();
    expect(notification.messages).toHaveLength(0);
  });

  it("no credentials stored in SQLite", async () => {
    const { monitor, databasePath } = monitorSetup([cItem("p1", true, 5)], [wItem("w1", "p1")]);
    await monitor.runOnce();
    using database = new DatabaseSync(databasePath);
    const columns = database.prepare("PRAGMA table_info(availability_state)").all() as Array<{ name: string }>;
    expect(columns.map(c => c.name)).not.toContain("botToken");
    expect(columns.map(c => c.name)).not.toContain("chatId");
  });

  it("mock notification provider logs with correct visual format", () => {
    const logs: string[] = [];
    const mockLogger: Logger = { info: (msg) => logs.push(msg), warn: () => undefined, error: () => undefined };
    const notification = new MockNotificationProvider(mockLogger);
    notification.notify("Test Message Details");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("[MOCK NOTIFICATION]");
    expect(logs[0]).toContain("🚨 Blinkit Wishlist Update");
    expect(logs[0]).toContain("Test Message Details");
    expect(notification.messages).toContain("Test Message Details");
  });
});
