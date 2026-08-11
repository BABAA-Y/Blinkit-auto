import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runWishlistCommand } from "../src/cli.js";
import { settingsFromEnvironment } from "../src/config.js";
import type { Logger } from "../src/logging.js";
import { WishlistRepository } from "../src/storage/wishlist.js";

const directories: string[] = [];
const events: Array<Record<string, unknown>> = [];
const logger: Logger = { info: (message, fields = {}) => { events.push({ message, ...fields }); }, warn: () => undefined, error: () => undefined };
afterEach(() => { events.splice(0); directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })); });

function repository(): WishlistRepository {
  const directory = mkdtempSync(join(tmpdir(), "blinkit-auto-")); directories.push(directory);
  const result = new WishlistRepository(join(directory, "test.sqlite3")); result.initialize(); return result;
}

describe("wishlist CLI management", () => {
  it("adds, lists, and removes a wishlist item", () => {
    const wishlist = repository();
    runWishlistCommand(["add", "milk", "mock-milk-1", "Milk (1 L)", "2", "70.00", "15"], wishlist, logger);
    expect(wishlist.list()).toMatchObject([{ id: "milk", quantity: 2, maximumUnitPricePaise: 7000, cooldownMinutes: 15, enabled: true }]);
    runWishlistCommand(["list"], wishlist, logger); expect(events.at(-1)?.items).toHaveLength(1);
    runWishlistCommand(["remove", "milk"], wishlist, logger); expect(wishlist.list()).toEqual([]);
  });

  it("enables and disables wishlist items", () => {
    const wishlist = repository();
    runWishlistCommand(["add", "milk", "mock-milk-1", "Milk", "1", "70", "0", "disabled"], wishlist, logger);
    expect(wishlist.list()[0]?.enabled).toBe(false);
    runWishlistCommand(["enable", "milk"], wishlist, logger); expect(wishlist.list()[0]?.enabled).toBe(true);
    runWishlistCommand(["disable", "milk"], wishlist, logger); expect(wishlist.list()[0]?.enabled).toBe(false);
  });

  it("rejects invalid wishlist values", () => {
    const wishlist = repository();
    expect(() => runWishlistCommand(["add", "milk", "sku", "Milk", "0", "70", "0"], wishlist, logger)).toThrow("positive integer");
    expect(() => runWishlistCommand(["add", "milk", "sku", "Milk", "1", "-1", "0"], wishlist, logger)).toThrow("non-negative decimal");
    expect(() => runWishlistCommand(["add", "milk", "sku", "Milk", "1", "70", "-1"], wishlist, logger)).toThrow("non-negative integer");
  });
});

describe("environment configuration", () => {
  it("accepts valid scheduler and budget configuration", () => {
    const settings = settingsFromEnvironment({
      BLINKIT_AUTO_SCHEDULER_INTERVAL_MS: "60000", BLINKIT_AUTO_DAILY_SPENDING_LIMIT: "125.50",
      BLINKIT_AUTO_MONTHLY_SPENDING_LIMIT: "500.00", BLINKIT_AUTO_MAX_ORDER_VALUE: "50.25",
    });
    expect(settings.schedulerIntervalMs).toBe(60_000);
    expect(settings.eligibilityLimits).toMatchObject({ dailySpendingLimitPaise: 12550, monthlySpendingLimitPaise: 50000, maximumOrderValuePaise: 5025 });
  });

  it("rejects invalid interval and budget configuration", () => {
    expect(() => settingsFromEnvironment({ BLINKIT_AUTO_SCHEDULER_INTERVAL_MS: "-1" })).toThrow("positive integer");
    expect(() => settingsFromEnvironment({ BLINKIT_AUTO_DAILY_SPENDING_LIMIT: "-1" })).toThrow("non-negative decimal");
    expect(() => settingsFromEnvironment({ BLINKIT_AUTO_MONTHLY_SPENDING_LIMIT: "1.999" })).toThrow("at most two decimal places");
  });
});
