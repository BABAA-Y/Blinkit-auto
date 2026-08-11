import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SimpleItemSelector } from "../src/ai/decision.js";
import { SafeAutomationService } from "../src/app.js";
import { PurchaseRules } from "../src/automation/rules.js";
import { settingsFromEnvironment } from "../src/config.js";
import { MockBlinkitCatalog } from "../src/integrations/blinkit.js";
import { MockOrderSubmissionProvider } from "../src/integrations/orders.js";
import type { Logger } from "../src/logging.js";
import { DecisionReason, type WishlistItem } from "../src/models.js";
import { OrderService } from "../src/orders/service.js";
import { MockPaymentProvider } from "../src/payments/provider.js";
import { WishlistScheduler } from "../src/scheduler.js";
import { DecisionRepository } from "../src/storage/sqlite.js";
import { OrderRepository } from "../src/storage/orders.js";
import { WishlistRepository } from "../src/storage/wishlist.js";
import { LocationRepository } from "../src/storage/location.js";
import { WishlistWorker } from "../src/worker.js";

const directories: string[] = [];
const logger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
const limits = { maximumOrderValuePaise: 20_000, dailySpendingLimitPaise: 50_000, monthlySpendingLimitPaise: 100_000, duplicateOrderWindowMinutes: 0 };
afterEach(() => { vi.useRealTimers(); directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })); });

function wishlist(overrides: Partial<WishlistItem> = {}): WishlistItem {
  return { id: "milk", productIdentifier: "mock-milk-1", productName: "Milk (1 L)", quantity: 1, maximumUnitPricePaise: 7000, enabled: true, cooldownMinutes: 0, ...overrides };
}

function worker(): { worker: WishlistWorker; decisions: DecisionRepository; orders: OrderRepository; wishlist: WishlistRepository } {
  const directory = mkdtempSync(join(tmpdir(), "blinkit-auto-")); directories.push(directory);
  const databasePath = join(directory, "test.sqlite3");
  const decisions = new DecisionRepository(databasePath); const orders = new OrderRepository(databasePath); const wishlistRepository = new WishlistRepository(databasePath);
  const location = new LocationRepository(databasePath);
  decisions.initialize(); orders.initialize(); wishlistRepository.initialize(); location.initialize();
  const catalogProvider = new MockBlinkitCatalog();
  const service = new SafeAutomationService(catalogProvider, catalogProvider, new SimpleItemSelector(), new PurchaseRules(limits), decisions, orders, location, logger);
  const orderService = new OrderService(orders, new MockPaymentProvider(), new MockOrderSubmissionProvider(), logger);
  return { worker: new WishlistWorker(wishlistRepository, service, orderService, logger), decisions, orders, wishlist: wishlistRepository };
}

describe("WishlistWorker", () => {
  it("runs the complete local workflow and records a decision", () => {
    const setup = worker(); setup.wishlist.save(wishlist());
    const result = setup.worker.runOnce(new Date("2026-08-11T12:00:00Z"));
    expect(result).toHaveLength(1); expect(result[0]?.reason).toBe(DecisionReason.APPROVED); expect(setup.decisions.count()).toBe(1); expect(setup.orders.list()).toHaveLength(1);
  });

  it("evaluates multiple wishlist items including rejected items", () => {
    const setup = worker(); setup.wishlist.save(wishlist());
    setup.wishlist.save(wishlist({ id: "disabled", productIdentifier: "mock-banana-1", productName: "Bananas (6 pcs)", enabled: false }));
    const result = setup.worker.runOnce(new Date("2026-08-11T12:00:00Z"));
    expect(result.map((decision) => decision.reason)).toEqual([DecisionReason.DISABLED, DecisionReason.APPROVED]); expect(setup.decisions.count()).toBe(2); expect(setup.orders.list()).toHaveLength(2);
  });
});

describe("WishlistScheduler and configuration", () => {
  it("reads a configurable worker interval", () => {
    expect(settingsFromEnvironment({ BLINKIT_AUTO_SCHEDULER_INTERVAL_MS: "1234" }).schedulerIntervalMs).toBe(1234);
    expect(() => settingsFromEnvironment({ BLINKIT_AUTO_SCHEDULER_INTERVAL_MS: "0" })).toThrow("positive integer");
  });

  it("runs immediately, then stops cleanly without further runs", () => {
    vi.useFakeTimers(); const runnable = { runOnce: vi.fn() }; const scheduler = new WishlistScheduler(runnable, 1_000, logger);
    scheduler.start(); expect(runnable.runOnce).toHaveBeenCalledTimes(1); vi.advanceTimersByTime(1_000); expect(runnable.runOnce).toHaveBeenCalledTimes(2);
    scheduler.stop(); expect(scheduler.isRunning).toBe(false); vi.advanceTimersByTime(5_000); expect(runnable.runOnce).toHaveBeenCalledTimes(2);
  });

  it("handles asynchronous execution and catches errors without stopping", async () => {
    vi.useFakeTimers();
    let runs = 0;
    const runnable = {
      runOnce: async () => {
        runs++;
        if (runs === 2) throw new Error("Async failure test");
      }
    };
    const errors: unknown[] = [];
    const testLogger: Logger = { info: () => undefined, warn: () => undefined, error: (_, ctx) => errors.push(ctx) };
    const scheduler = new WishlistScheduler(runnable, 1_000, testLogger);
    
    scheduler.start();
    expect(runs).toBe(1);
    
    // Using fake timers with async operations
    await vi.advanceTimersByTimeAsync(1_000);
    expect(runs).toBe(2);
    expect(errors).toHaveLength(1); // Caught the second run error
    
    await vi.advanceTimersByTimeAsync(1_000);
    expect(runs).toBe(3); // Scheduler continued working
    
    scheduler.stop();
  });
});
