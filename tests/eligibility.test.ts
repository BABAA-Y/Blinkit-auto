import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalProductMatcher } from "../src/ai/decision.js";
import { SafeAutomationService } from "../src/app.js";
import { PurchaseRules } from "../src/automation/rules.js";
import type { AvailabilityProvider, ProductSearchProvider } from "../src/integrations/providers.js";
import type { Logger } from "../src/logging.js";
import { DecisionReason, type CatalogItem, type EligibilityLimits, type WishlistItem } from "../src/models.js";
import { DecisionRepository } from "../src/storage/sqlite.js";
import { OrderRepository } from "../src/storage/orders.js";
import { LocationRepository } from "../src/storage/location.js";

const NOW = new Date("2026-08-11T12:00:00.000Z");
const directories: string[] = [];
const silentLogger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
const defaultLimits: EligibilityLimits = {
  maximumOrderValuePaise: 20_000, dailySpendingLimitPaise: 50_000,
  monthlySpendingLimitPaise: 100_000, duplicateOrderWindowMinutes: 60,
};

afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

function wishlist(overrides: Partial<WishlistItem> = {}): WishlistItem {
  return {
    id: "milk-wishlist", desiredProductName: "Milk", quantity: 1,
    maximumUnitPricePaise: 10_000, enabled: true, cooldownMinutes: 0, ...overrides,
  };
}

function item(overrides: Partial<CatalogItem> = {}): CatalogItem {
  return { sku: "milk", name: "Milk", pricePaise: 5000, available: true, availableQuantity: 10, ...overrides };
}

function service(items: readonly CatalogItem[], limits: EligibilityLimits = defaultLimits): SafeAutomationService {
  const directory = mkdtempSync(join(tmpdir(), "blinkit-auto-"));
  directories.push(directory);
  const repository = new DecisionRepository(join(directory, "test.sqlite3"));
  const orderRepo = new OrderRepository(join(directory, "test.sqlite3"));
  repository.initialize();
  orderRepo.initialize();
  const catalog: ProductSearchProvider = { searchProducts: () => items };
  const availability: AvailabilityProvider = { getAvailability: (productIdentifier) => {
    const found = items.find((candidate) => candidate.sku === productIdentifier);
    return found === undefined ? undefined : { productIdentifier, available: found.available, availableQuantity: found.availableQuantity };
  } };
  const mockHistory = {
    finalizedSpendingBetween: (start: Date, end: Date) => repository.approvedSpendingBetween(start, end),
    latestFinalizedForWishlist: (id: string) => repository.latestApprovedForWishlist(id),
    latestFinalizedForProduct: (id: string) => repository.latestApprovedForProduct(id),
  };
  const location = new LocationRepository(join(directory, "test.sqlite3"));
  location.initialize();
  return new SafeAutomationService(catalog, availability, new LocalProductMatcher(), new PurchaseRules(limits), repository, mockHistory, location, silentLogger);
}

describe("local purchase eligibility engine", () => {
  it("approves an available item within all budgets", async () => {
    expect((await service([item()]).evaluateWishlistItem(wishlist(), NOW)).reason).toBe(DecisionReason.APPROVED);
  });

  it("rejects a wishlist product that does not exist in the catalog", async () => {
    expect((await service([]).evaluateWishlistItem(wishlist(), NOW)).reason).toBe(DecisionReason.PRODUCT_NOT_FOUND);
  });

  it("rejects an unavailable item", async () => {
    expect((await service([item({ available: false, availableQuantity: 0 })]).evaluateWishlistItem(wishlist(), NOW)).reason)
      .toBe(DecisionReason.OUT_OF_STOCK);
  });

  it("rejects a price above the wishlist maximum", async () => {
    expect((await service([item({ pricePaise: 5001 })]).evaluateWishlistItem(wishlist({ maximumUnitPricePaise: 5000 }), NOW)).reason)
      .toBe(DecisionReason.PRICE_TOO_HIGH);
  });

  it("rejects insufficient quantity", async () => {
    expect((await service([item({ availableQuantity: 1 })]).evaluateWishlistItem(wishlist({ quantity: 2 }), NOW)).reason)
      .toBe(DecisionReason.INSUFFICIENT_QUANTITY);
  });

  it("rejects an order above its maximum value", async () => {
    const limits = { ...defaultLimits, maximumOrderValuePaise: 9000 };
    expect((await service([item() ], limits).evaluateWishlistItem(wishlist({ quantity: 2 }), NOW)).reason)
      .toBe(DecisionReason.MAX_ORDER_VALUE_EXCEEDED);
  });

  it("rejects when the daily budget would be exceeded", async () => {
    const engine = service([item()], { ...defaultLimits, dailySpendingLimitPaise: 9000 });
    expect((await engine.evaluateWishlistItem(wishlist({ id: "first", desiredProductName: "Milk", cooldownMinutes: 0 }), NOW)).reason)
      .toBe(DecisionReason.APPROVED);
    expect((await engine.evaluateWishlistItem(wishlist({ id: "second", desiredProductName: "Milk", cooldownMinutes: 0 }), NOW)).reason)
      .toBe(DecisionReason.DAILY_BUDGET_EXCEEDED);
  });

  it("rejects when the monthly budget would be exceeded", async () => {
    const engine = service([item()], { ...defaultLimits, dailySpendingLimitPaise: 50_000, monthlySpendingLimitPaise: 9000 });
    expect((await engine.evaluateWishlistItem(wishlist({ id: "first", desiredProductName: "Milk", cooldownMinutes: 0 }), NOW)).reason)
      .toBe(DecisionReason.APPROVED);
    expect((await engine.evaluateWishlistItem(wishlist({ id: "second", desiredProductName: "Milk", cooldownMinutes: 0 }), NOW)).reason)
      .toBe(DecisionReason.MONTHLY_BUDGET_EXCEEDED);
  });

  it("rejects a wishlist item during its cooldown", async () => {
    const engine = service([item()], { ...defaultLimits, duplicateOrderWindowMinutes: 0 });
    expect((await engine.evaluateWishlistItem(wishlist({ cooldownMinutes: 30 }), NOW)).reason).toBe(DecisionReason.APPROVED);
    expect((await engine.evaluateWishlistItem(wishlist({ cooldownMinutes: 30 }), new Date(NOW.getTime() + 60_000))).reason)
      .toBe(DecisionReason.COOLDOWN_ACTIVE);
  });

  it("rejects a recent duplicate order", async () => {
    const engine = service([item()]);
    expect((await engine.evaluateWishlistItem(wishlist({ cooldownMinutes: 0 }), NOW)).reason).toBe(DecisionReason.APPROVED);
    expect((await engine.evaluateWishlistItem(wishlist({ id: "another-wishlist", cooldownMinutes: 0 }), new Date(NOW.getTime() + 60_000))).reason)
      .toBe(DecisionReason.DUPLICATE_ORDER);
  });

  it("rejects a disabled wishlist item", async () => {
    expect((await service([item()]).evaluateWishlistItem(wishlist({ enabled: false }), NOW)).reason).toBe(DecisionReason.DISABLED);
  });

  it("evaluates multiple wishlist items and records each local decision", async () => {
    const engine = service([item(), item({ sku: "banana", name: "Bananas", pricePaise: 3000 })], { ...defaultLimits, duplicateOrderWindowMinutes: 0 });
    const decisions = await engine.evaluateWishlist([wishlist(), wishlist({ id: "banana-wishlist", desiredProductName: "Bananas" })], NOW);
    expect(decisions.map((decision) => decision.reason)).toEqual([DecisionReason.APPROVED, DecisionReason.APPROVED]);
  });
});
