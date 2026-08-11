import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocationRepository } from "../src/storage/location.js";
import { MockBlinkitCatalog } from "../src/integrations/blinkit.js";
import { WishlistMonitor } from "../src/monitor.js";
import { MockNotificationProvider } from "../src/notifications/mock.js";
import { SimpleItemSelector } from "../src/ai/decision.js";
import type { WishlistProvider } from "../src/integrations/providers.js";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe("Location-aware features", () => {
  it("persists delivery location", () => {
    const directory = mkdtempSync(join(tmpdir(), "blinkit-auto-"));
    directories.push(directory);
    const databasePath = join(directory, "test.sqlite3");

    const repo = new LocationRepository(databasePath);
    repo.initialize();

    expect(repo.get()).toBeUndefined();
    repo.set({ pincode: "248001", city: "Dehradun", state: "Uttarakhand" });
    
    expect(repo.get()).toMatchObject({ pincode: "248001", city: "Dehradun", state: "Uttarakhand" });
    
    // new instance to verify persistence
    const newRepo = new LocationRepository(databasePath);
    expect(newRepo.get()).toMatchObject({ pincode: "248001", city: "Dehradun", state: "Uttarakhand" });
  });

  it("MockBlinkitCatalog supports different availability by location", () => {
    const directory = mkdtempSync(join(tmpdir(), "blinkit-auto-"));
    directories.push(directory);
    const databasePath = join(directory, "test.sqlite3");

    const catalog = new MockBlinkitCatalog(databasePath);
    catalog.setAvailability("mock-banana-1", true, 10, "248001");
    catalog.setAvailability("mock-banana-1", false, 0, "110001");

    expect(catalog.getAvailability("mock-banana-1", { pincode: "248001" })?.available).toBe(true);
    expect(catalog.getAvailability("mock-banana-1", { pincode: "110001" })?.available).toBe(false);
  });

  it("Monitor uses the configured location", async () => {
    const directory = mkdtempSync(join(tmpdir(), "blinkit-auto-"));
    directories.push(directory);
    const databasePath = join(directory, "test.sqlite3");

    const locationRepo = new LocationRepository(databasePath);
    locationRepo.initialize();
    locationRepo.set({ pincode: "248001" });

    const catalog = new MockBlinkitCatalog(databasePath);
    catalog.setAvailability("mock-banana-1", false, 0, "*");
    catalog.setAvailability("mock-banana-1", true, 5, "248001");

    const wishlist: WishlistProvider = {
      list: () => [{ id: "w1", productIdentifier: "mock-banana-1", productName: "Banana", quantity: 1, maximumUnitPricePaise: 5000, enabled: true, cooldownMinutes: 0 }]
    };

    const notification = new MockNotificationProvider();
    const monitor = new WishlistMonitor(wishlist, catalog, catalog, new SimpleItemSelector(), notification, locationRepo, databasePath, { info: () => {}, warn: () => {}, error: () => {} });
    monitor.initialize();

    await monitor.runOnce();
    // It should be available for 248001 and trigger a notification
    expect(notification.messages).toHaveLength(1);
    expect(notification.messages[0]).toContain("Location: 248001");
    expect(notification.messages[0]).not.toContain("Street"); // No full address stored
  });

  it("available in another location but unavailable in configured location", async () => {
    const directory = mkdtempSync(join(tmpdir(), "blinkit-auto-"));
    directories.push(directory);
    const databasePath = join(directory, "test.sqlite3");

    const locationRepo = new LocationRepository(databasePath);
    locationRepo.initialize();
    locationRepo.set({ pincode: "110001" }); // Unavailable location

    const catalog = new MockBlinkitCatalog(databasePath);
    catalog.setAvailability("mock-banana-1", true, 5, "248001");
    catalog.setAvailability("mock-banana-1", false, 0, "110001");

    const wishlist: WishlistProvider = {
      list: () => [{ id: "w1", productIdentifier: "mock-banana-1", productName: "Banana", quantity: 1, maximumUnitPricePaise: 5000, enabled: true, cooldownMinutes: 0 }]
    };

    const notification = new MockNotificationProvider();
    const monitor = new WishlistMonitor(wishlist, catalog, catalog, new SimpleItemSelector(), notification, locationRepo, databasePath, { info: () => {}, warn: () => {}, error: () => {} });
    monitor.initialize();

    await monitor.runOnce();
    // Should NOT trigger notification because it's unavailable in 110001
    expect(notification.messages).toHaveLength(0);
  });
});
