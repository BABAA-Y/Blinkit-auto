import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runWishlistCommand } from "../src/cli.js";
import { settingsFromEnvironment } from "../src/config.js";
import type { TerminalUI } from "../src/ui/output.js";
import { WishlistRepository } from "../src/storage/wishlist.js";

const directories: string[] = [];
const events: string[] = [];
const ui: any = {
  header: (msg: string) => events.push(`[HEADER] ${msg}`),
  success: (msg: string) => events.push(`[SUCCESS] ${msg}`),
  error: (msg: string) => events.push(`[ERROR] ${msg}`),
  info: (msg: string) => events.push(`[INFO] ${msg}`),
  warning: (msg: string) => events.push(`[WARNING] ${msg}`),
  message: (msg: string) => events.push(`[MESSAGE] ${msg}`),
  printTable: (h: string[], r: any[]) => events.push(`[TABLE] Rows: ${r.length}`),
  printObject: (obj: any) => events.push(`[OBJECT] ${JSON.stringify(obj)}`),
};
afterEach(() => { events.splice(0); directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })); });

function repository(): WishlistRepository {
  const directory = mkdtempSync(join(tmpdir(), "blinkit-auto-")); directories.push(directory);
  const result = new WishlistRepository(join(directory, "test.sqlite3")); result.initialize(); return result;
}

describe("wishlist CLI management", () => {
  it("adds, lists, and removes a wishlist item", () => {
    const wishlist = repository();
    runWishlistCommand(["add", "milk", "Milk", "2", "70.00", "15"], wishlist, ui);
    expect(wishlist.list()).toMatchObject([{ id: "milk", quantity: 2, maximumUnitPricePaise: 7000, cooldownMinutes: 15, enabled: true }]);
    runWishlistCommand(["list"], wishlist, ui); expect(events.at(-1)).toBe("[TABLE] Rows: 1");
    runWishlistCommand(["remove", "milk"], wishlist, ui); expect(wishlist.list()).toEqual([]);
  });

  it("enables and disables wishlist items", () => {
    const wishlist = repository();
    runWishlistCommand(["add", "milk", "Milk", "1", "70", "0", "disabled"], wishlist, ui);
    expect(wishlist.list()[0]?.enabled).toBe(false);
    runWishlistCommand(["enable", "milk"], wishlist, ui); expect(wishlist.list()[0]?.enabled).toBe(true);
    runWishlistCommand(["disable", "milk"], wishlist, ui); expect(wishlist.list()[0]?.enabled).toBe(false);
  });

  it("rejects invalid wishlist values", () => {
    const wishlist = repository();
    expect(() => runWishlistCommand(["add", "milk", "Milk", "0", "70", "0"], wishlist, ui)).toThrow("positive integer");
    expect(() => runWishlistCommand(["add", "milk", "Milk", "1", "-1", "0"], wishlist, ui)).toThrow("non-negative decimal");
    expect(() => runWishlistCommand(["add", "milk", "Milk", "1", "70", "-1"], wishlist, ui)).toThrow("non-negative integer");
  });

  it("resets availability state safely", () => {
    const wishlist = repository();
    const dbPath = (wishlist as any).databasePath;
    
    // Test without database path
    expect(() => runWishlistCommand(["reset-availability", "milk", "110011"], wishlist, ui)).toThrow("Database path required");

    // Test with database path - no existing state
    runWishlistCommand(["reset-availability", "milk", "110011"], wishlist, ui, dbPath);
    expect(events.at(-1)).toContain("[WARNING] No existing availability state found");

    // Seed data manually to test reset
    const { DatabaseSync } = require("node:sqlite");
    using database = new DatabaseSync(dbPath);
    database.exec(`CREATE TABLE IF NOT EXISTS availability_state (
      wishlist_id TEXT, pincode TEXT, available INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (wishlist_id, pincode)
    )`);
    database.prepare("INSERT INTO availability_state (wishlist_id, pincode, available, updated_at) VALUES (?, ?, ?, ?)").run("milk", "110011", 1, new Date().toISOString());
    
    // Test with database path - with existing state
    runWishlistCommand(["reset-availability", "milk", "110011"], wishlist, ui, dbPath);
    expect(events.at(-1)).toContain("[SUCCESS] Availability state reset to unavailable");
    
    const row = database.prepare("SELECT available FROM availability_state WHERE wishlist_id = 'milk'").get() as any;
    expect(row.available).toBe(0);
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
