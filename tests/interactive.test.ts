import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import prompts from "prompts";
import { startInteractiveMenu } from "../src/ui/interactive.js";
import { WishlistRepository } from "../src/storage/wishlist.js";
import { LocationRepository } from "../src/storage/location.js";
import { SettingsRepository } from "../src/storage/settings.js";
import type { TerminalUI } from "../src/ui/output.js";
import type { Settings } from "../src/config.js";
import type { Logger } from "../src/logging.js";
import { cliUsage } from "../src/cli.js";
import { execSync } from "node:child_process";

const directories: string[] = [];
afterEach(() => {
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
  vi.clearAllMocks();
});

function setup() {
  const directory = mkdtempSync(join(tmpdir(), "blinkit-auto-"));
  directories.push(directory);
  const databasePath = join(directory, "test.sqlite3");
  
  const wishlist = new WishlistRepository(databasePath);
  wishlist.initialize();
  const location = new LocationRepository(databasePath);
  location.initialize();
  const appSettings = new SettingsRepository(databasePath);
  appSettings.initialize();
  
  const compositeWorker = { runOnce: vi.fn().mockResolvedValue([{ approved: true }, { approved: false }]) };
  
  const settings: Settings = {
    databasePath,
    logLevel: "INFO",
    schedulerIntervalMs: 300000,
    eligibilityLimits: { maximumOrderValuePaise: 20000, dailySpendingLimitPaise: 50000, monthlySpendingLimitPaise: 100000, duplicateOrderWindowMinutes: 60 },
    notificationProvider: "mock",
    catalogProvider: "mock",
    apiTimeoutMs: 5000
  };
  
  const ui = {
    header: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn(),
    printTable: vi.fn(), printObject: vi.fn()
  } as unknown as TerminalUI;
  
  const logger: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  
  return { wishlist, location, appSettings, compositeWorker, settings, ui, logger };
}

describe("Interactive Menu", () => {
  beforeEach(() => {
    // Suppress console.log output during tests to keep console clean
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "clear").mockImplementation(() => {});
  });

  it("can exit immediately", async () => {
    const { wishlist, location, appSettings, compositeWorker, settings, ui, logger } = setup();
    prompts.inject(["exit"]);
    await startInteractiveMenu(wishlist, location, appSettings, compositeWorker, settings, ui, logger);
    expect(ui.success).toHaveBeenCalledWith("Goodbye!");
  });

  it("can add a wishlist item and generate an automatic ID", async () => {
    const { wishlist, location, appSettings, compositeWorker, settings, ui, logger } = setup();
    
    prompts.inject([
      "add",
      "Milk",
      "Amul",
      50, // maxPrice
      2, // quantity
      "dairy", // keywords
      30, // cooldown
      "", // enter to continue
      "exit"
    ]);

    await startInteractiveMenu(wishlist, location, appSettings, compositeWorker, settings, ui, logger);
    
    const items = wishlist.list();
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBeDefined();
    expect(items[0]!.desiredProductName).toBe("Milk");
    expect(items[0]!.brand).toBe("Amul");
    expect(items[0]!.maximumUnitPricePaise).toBe(5000);
    expect(items[0]!.quantity).toBe(2);
    expect(items[0]!.keywords).toEqual(["dairy"]);
    expect(items[0]!.cooldownMinutes).toBe(30);
  });

  it("can view wishlist", async () => {
    const { wishlist, location, appSettings, compositeWorker, settings, ui, logger } = setup();
    
    wishlist.save({ id: "milk123", desiredProductName: "Milk", maximumUnitPricePaise: 5000, quantity: 2, cooldownMinutes: 30, enabled: true });
    
    prompts.inject(["view", "", "exit"]);
    await startInteractiveMenu(wishlist, location, appSettings, compositeWorker, settings, ui, logger);
    
    expect(ui.printTable).toHaveBeenCalled();
  });

  it("can remove a wishlist item", async () => {
    const { wishlist, location, appSettings, compositeWorker, settings, ui, logger } = setup();
    
    wishlist.save({ id: "milk123", desiredProductName: "Milk", maximumUnitPricePaise: 5000, quantity: 2, cooldownMinutes: 30, enabled: true });
    
    prompts.inject(["remove", "milk123", true, "", "exit"]);
    await startInteractiveMenu(wishlist, location, appSettings, compositeWorker, settings, ui, logger);
    
    expect(wishlist.list()).toHaveLength(0);
    expect(ui.success).toHaveBeenCalledWith("Product removed from wishlist.");
  });

  it("can check now and run worker", async () => {
    const { wishlist, location, appSettings, compositeWorker, settings, ui, logger } = setup();
    
    prompts.inject(["check", "", "exit"]);
    await startInteractiveMenu(wishlist, location, appSettings, compositeWorker, settings, ui, logger);
    
    expect(compositeWorker.runOnce).toHaveBeenCalled();
  });

  it("can start and stop monitoring scheduler", async () => {
    const { wishlist, location, appSettings, compositeWorker, settings, ui, logger } = setup();
    
    prompts.inject(["monitor", "", "monitor", "", "exit"]);
    await startInteractiveMenu(wishlist, location, appSettings, compositeWorker, settings, ui, logger);
    
    // The second monitor command stops the scheduler
    expect(ui.success).toHaveBeenCalledWith("Monitoring stopped.");
  });

  it("can update delivery location", async () => {
    const { wishlist, location, appSettings, compositeWorker, settings, ui, logger } = setup();
    
    prompts.inject(["location", true, "110001", "Delhi", "Delhi", "", "exit"]);
    await startInteractiveMenu(wishlist, location, appSettings, compositeWorker, settings, ui, logger);
    
    const loc = location.get();
    expect(loc?.pincode).toBe("110001");
    expect(loc?.city).toBe("Delhi");
    expect(loc?.state).toBe("Delhi");
    expect(ui.success).toHaveBeenCalledWith("Location updated successfully.");
  });
  
  it("shows interactive in CLI usage as the first option", () => {
    expect(cliUsage()).toContain("(no command)                    Open interactive menu");
  });

  describe("Connect Telegram Priority", () => {
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("Case A: serverUrl and botToken configured -> uses server flow", async () => {
      const { wishlist, location, appSettings, compositeWorker, settings, ui, logger } = setup();
      settings.serverUrl = "http://localhost:3000";
      settings.telegramBotToken = "local-token";
      
      global.fetch = vi.fn().mockImplementation(async (url) => {
        if (url.toString().includes("/api/link/session")) {
          return { ok: true, json: async () => ({ linkingCode: "123456", botUsername: "testbot" }) };
        }
        if (url.toString().includes("/api/link/status")) {
          return { ok: true, json: async () => ({ linked: true, userToken: "user123" }) };
        }
        return { ok: false };
      }) as any;
      
      prompts.inject(["settings", "telegram", "", "back", "exit"]);
      await startInteractiveMenu(wishlist, location, appSettings, compositeWorker, settings, ui, logger);
      
      expect(ui.info).toHaveBeenCalledWith("Requesting linking session from server...");
      expect(global.fetch).toHaveBeenCalledWith("http://localhost:3000/api/link/session", expect.any(Object));
    });

    it("Case B: serverUrl missing, botToken configured -> uses local flow", async () => {
      const { wishlist, location, appSettings, compositeWorker, settings, ui, logger } = setup();
      delete settings.serverUrl;
      settings.telegramBotToken = "local-token";
      
      prompts.inject(["settings", "telegram", "", "back", "exit"]);
      await startInteractiveMenu(wishlist, location, appSettings, compositeWorker, settings, ui, logger);
      
      expect(ui.info).toHaveBeenCalledWith("Telegram is already configured locally via .env (TELEGRAM_BOT_TOKEN).");
    });

    it("Case C: serverUrl configured, botToken missing -> uses server flow", async () => {
      const { wishlist, location, appSettings, compositeWorker, settings, ui, logger } = setup();
      settings.serverUrl = "http://localhost:3000";
      delete settings.telegramBotToken;
      
      global.fetch = vi.fn().mockImplementation(async (url) => {
        if (url.toString().includes("/api/link/session")) {
          return { ok: true, json: async () => ({ linkingCode: "123456", botUsername: "testbot" }) };
        }
        if (url.toString().includes("/api/link/status")) {
          return { ok: true, json: async () => ({ linked: true, userToken: "user123" }) };
        }
        return { ok: false };
      }) as any;
      
      prompts.inject(["settings", "telegram", "", "back", "exit"]);
      await startInteractiveMenu(wishlist, location, appSettings, compositeWorker, settings, ui, logger);
      
      expect(ui.info).toHaveBeenCalledWith("Requesting linking session from server...");
    });

    it("Case D: both missing -> shows configuration error", async () => {
      const { wishlist, location, appSettings, compositeWorker, settings, ui, logger } = setup();
      delete settings.serverUrl;
      delete settings.telegramBotToken;
      
      prompts.inject(["settings", "telegram", "", "back", "exit"]);
      await startInteractiveMenu(wishlist, location, appSettings, compositeWorker, settings, ui, logger);
      
      expect(ui.error).toHaveBeenCalledWith("Telegram is not configured. Please set BLINKIT_AUTO_SERVER_URL or TELEGRAM_BOT_TOKEN in .env.");
    });
  });

  describe("Telegram Status Display", () => {
    let consoleLogSpy: any;
    beforeEach(() => {
      consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    });

    it("server URL + not linked (provider=telegram)", async () => {
      const { wishlist, location, appSettings, compositeWorker, settings, ui, logger } = setup();
      settings.serverUrl = "http://server";
      settings.notificationProvider = "telegram";
      appSettings.set("telegram_linked_user_id", "");
      prompts.inject(["exit"]);
      await startInteractiveMenu(wishlist, location, appSettings, compositeWorker, settings, ui, logger);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Telegram Notifications: Available / Not Connected"));
    });

    it("server URL + successfully linked (provider=telegram)", async () => {
      const { wishlist, location, appSettings, compositeWorker, settings, ui, logger } = setup();
      settings.serverUrl = "http://server";
      settings.notificationProvider = "telegram";
      appSettings.set("telegram_linked_user_id", "123");
      prompts.inject(["exit"]);
      await startInteractiveMenu(wishlist, location, appSettings, compositeWorker, settings, ui, logger);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Telegram Notifications: Enabled"));
    });

    it("legacy local-token mode", async () => {
      const { wishlist, location, appSettings, compositeWorker, settings, ui, logger } = setup();
      delete settings.serverUrl;
      settings.telegramBotToken = "token";
      settings.telegramChatId = "chat";
      settings.notificationProvider = "telegram";
      prompts.inject(["exit"]);
      await startInteractiveMenu(wishlist, location, appSettings, compositeWorker, settings, ui, logger);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Telegram Notifications: Enabled"));
    });

    it("no Telegram configuration", async () => {
      const { wishlist, location, appSettings, compositeWorker, settings, ui, logger } = setup();
      delete settings.serverUrl;
      delete settings.telegramBotToken;
      settings.notificationProvider = "telegram";
      prompts.inject(["exit"]);
      await startInteractiveMenu(wishlist, location, appSettings, compositeWorker, settings, ui, logger);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Telegram Notifications: Disabled"));
    });
  });

  describe("Test Telegram Notification", () => {
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("sends test notification successfully to server backend", async () => {
      const { wishlist, location, appSettings, compositeWorker, settings, ui, logger } = setup();
      settings.serverUrl = "http://server.com";
      appSettings.set("telegram_linked_user_id", "test-user-id");
      
      global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      
      prompts.inject(["settings", "test_notification", "", "back", "exit"]);
      await startInteractiveMenu(wishlist, location, appSettings, compositeWorker, settings, ui, logger);
      
      expect(global.fetch).toHaveBeenCalledWith("http://server.com/api/notify", expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("test-user-id")
      }));
      expect(ui.success).toHaveBeenCalledWith(expect.stringContaining("HTTP 200"));
    });

    it("handles test notification failure gracefully", async () => {
      const { wishlist, location, appSettings, compositeWorker, settings, ui, logger } = setup();
      settings.serverUrl = "http://server.com";
      appSettings.set("telegram_linked_user_id", "test-user-id");
      
      global.fetch = vi.fn().mockResolvedValue({ 
        ok: false, 
        status: 400, 
        json: async () => ({ error: "Invalid userToken" }) 
      });
      
      prompts.inject(["settings", "test_notification", "", "back", "exit"]);
      await startInteractiveMenu(wishlist, location, appSettings, compositeWorker, settings, ui, logger);
      
      expect(ui.error).toHaveBeenCalledWith(expect.stringContaining("HTTP 400"));
      expect(ui.error).toHaveBeenCalledWith(expect.stringContaining("Invalid userToken"));
    });
  });
});
