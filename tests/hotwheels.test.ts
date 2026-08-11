import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockBlinkitCatalog } from "../src/integrations/blinkit.js";
import { LocationRepository } from "../src/storage/location.js";
import { WishlistMonitor } from "../src/monitor.js";
import { LocalProductMatcher } from "../src/ai/decision.js";
import { MockNotificationProvider } from "../src/notifications/mock.js";
import type { WishlistProvider } from "../src/integrations/providers.js";
import type { WishlistItem } from "../src/models.js";
import { SafeAutomationService } from "../src/app.js";
import { PurchaseRules } from "../src/automation/rules.js";
import { DecisionRepository } from "../src/storage/sqlite.js";
import { DecisionReason } from "../src/models.js";
import type { Logger } from "../src/logging.js";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

const silentLogger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

function testSetup() {
  const directory = mkdtempSync(join(tmpdir(), "blinkit-auto-"));
  directories.push(directory);
  const databasePath = join(directory, "test.sqlite3");

  const location = new LocationRepository(databasePath);
  location.initialize();
  location.set({ pincode: "248007", city: "Dehradun", state: "Uttarakhand" });

  const catalog = new MockBlinkitCatalog(databasePath);
  
  const wishlistItems: WishlistItem[] = [{
    id: "hw-chevy-63",
    desiredProductName: "Hot Wheels '63 Chevy II Die Cast Car",
    brand: "Hot Wheels",
    keywords: ["63 Chevy II", "Chevy II", "Die Cast Car"],
    quantity: 1,
    maximumUnitPricePaise: 20000, // ₹200
    enabled: true,
    cooldownMinutes: 0
  }];

  const wishlist: WishlistProvider = { list: () => wishlistItems };
  const notification = new MockNotificationProvider();
  
  const monitor = new WishlistMonitor(wishlist, catalog, catalog, new LocalProductMatcher(), notification, location, databasePath, silentLogger);
  monitor.initialize();

  const decisions = new DecisionRepository(databasePath);
  decisions.initialize();

  const service = new SafeAutomationService(
    catalog, catalog, new LocalProductMatcher(),
    new PurchaseRules({ maximumOrderValuePaise: 100000, dailySpendingLimitPaise: 100000, monthlySpendingLimitPaise: 100000, duplicateOrderWindowMinutes: 0 }),
    decisions, 
    { finalizedSpendingBetween: () => 0, latestFinalizedForWishlist: () => undefined, latestFinalizedForProduct: () => undefined },
    location,
    silentLogger
  );

  return { monitor, catalog, notification, wishlistItems, service };
}

describe("Realistic Hot Wheels Scenario", () => {
  it("A. Product unavailable at 248007", async () => {
    const { monitor, catalog, notification, wishlistItems, service } = testSetup();
    catalog.setAvailability("mock-hotwheels-chevy", false, 0, "248007");

    // Monitor test
    await monitor.runOnce();
    expect(notification.messages).toHaveLength(0);

    // Engine rules test
    const decision = await service.evaluateWishlistItem(wishlistItems[0]!);
    expect(decision.reason).toBe(DecisionReason.OUT_OF_STOCK);
    expect(decision.approved).toBe(false);
  });

  it("B. Product available at 248007 with quantity 1 and price ₹179", async () => {
    const { monitor, catalog, notification, wishlistItems, service } = testSetup();
    catalog.setAvailability("mock-hotwheels-chevy", true, 1, "248007");

    // Monitor test
    await monitor.runOnce();
    expect(notification.messages).toHaveLength(1);
    expect(notification.messages[0]).toContain("Hot Wheels '63 Chevy II");
    expect(notification.messages[0]).toContain("₹179.00");
    expect(notification.messages[0]).toContain("Location: 248007");

    // Engine rules test
    const decision = await service.evaluateWishlistItem(wishlistItems[0]!);
    expect(decision.reason).toBe(DecisionReason.APPROVED);
    expect(decision.approved).toBe(true);
    expect(decision.orderValuePaise).toBe(17900);
  });

  it("C. Product available at 248007 but price ₹250", async () => {
    const { monitor, catalog, notification, wishlistItems, service } = testSetup();
    catalog.setAvailability("mock-hotwheels-chevy", true, 1, "248007");
    
    const sqlite3 = await import("node:sqlite");
    using db = new sqlite3.DatabaseSync((catalog as any).databasePath);
    db.prepare("UPDATE mock_catalog SET price_paise = 25000 WHERE sku = 'mock-hotwheels-chevy'").run();

    await monitor.runOnce();
    expect(notification.messages).toHaveLength(0); // ₹250 > ₹200 (max price)

    const decision = await service.evaluateWishlistItem(wishlistItems[0]!);
    expect(decision.reason).toBe(DecisionReason.PRICE_TOO_HIGH);
    expect(decision.approved).toBe(false);
  });

  it("D. Product unavailable at 248007 but available at another pincode", async () => {
    const { monitor, catalog, notification, wishlistItems, service } = testSetup();
    catalog.setAvailability("mock-hotwheels-chevy", false, 0, "248007");
    catalog.setAvailability("mock-hotwheels-chevy", true, 10, "110001");

    await monitor.runOnce();
    expect(notification.messages).toHaveLength(0);

    const decision = await service.evaluateWishlistItem(wishlistItems[0]!);
    expect(decision.reason).toBe(DecisionReason.OUT_OF_STOCK);
    expect(decision.approved).toBe(false);
  });
  
  it("Verify matching uses keywords, brand, and exact match to get best score", () => {
    const matcher = new LocalProductMatcher();
    const wishlistItem = {
      id: "hw-chevy-63",
      desiredProductName: "Hot Wheels '63 Chevy II Die Cast Car",
      brand: "Hot Wheels",
      keywords: ["63 Chevy II", "Chevy II", "Die Cast Car"],
      quantity: 1,
      maximumUnitPricePaise: 20000,
      enabled: true,
      cooldownMinutes: 0
    };
    
    // exact name
    const candidates = [
      { sku: "item-1", name: "Hot Wheels '63 Chevy II Die Cast Car", pricePaise: 17900, available: true, availableQuantity: 5 },
      { sku: "item-2", name: "Random Die Cast Car", pricePaise: 17900, available: true, availableQuantity: 5 }
    ];
    
    const selected = matcher.select(wishlistItem, candidates);
    expect(selected?.sku).toBe("item-1");
  });
});
