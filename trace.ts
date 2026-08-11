import { config } from "dotenv";
config();

import { LocalProductMatcher } from "./src/ai/decision.js";
import { SafeAutomationService } from "./src/app.js";
import { PurchaseRules } from "./src/automation/rules.js";
import { settingsFromEnvironment } from "./src/config.js";
import { AuthorizedDataAggregatorProvider } from "./src/integrations/authorized-catalog.js";
import { MockOrderSubmissionProvider } from "./src/integrations/orders.js";
import { OrderService } from "./src/orders/service.js";
import { MockPaymentProvider } from "./src/payments/provider.js";
import { DecisionRepository } from "./src/storage/sqlite.js";
import { OrderRepository } from "./src/storage/orders.js";
import { WishlistRepository } from "./src/storage/wishlist.js";
import { LocationRepository } from "./src/storage/location.js";
import { WishlistWorker } from "./src/worker.js";
import { WishlistMonitor } from "./src/monitor.js";
import { TelegramNotificationProvider } from "./src/notifications/telegram.js";
import { MockNotificationProvider } from "./src/notifications/mock.js";
import fs from "fs";

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = input.toString();
  const headers = init?.headers as any;
  let redactedInit = { ...init };
  if (headers && headers["X-API-Key"]) {
    redactedInit.headers = { ...headers, "X-API-Key": "<REDACTED>" };
  }
  
  console.log(`\n[TRACE] fetch called: ${url.replace(/api_key=[^&]*/, "api_key=<REDACTED>")}`);
  const response = await originalFetch(input, init);
  
  const clone = response.clone();
  let json;
  try {
    json = await clone.json();
    console.log(`[TRACE] fetch HTTP Status: ${response.status}`);
    console.log(`[TRACE] fetch Response payload: ${JSON.stringify(json, null, 2).substring(0, 500)}...`);
  } catch (e) {
    console.log(`[TRACE] fetch Response could not be parsed as JSON. Status: ${response.status}`);
  }
  return response;
};

async function trace() {
  const settings = settingsFromEnvironment();
  const logger = {
    info: (msg, meta) => console.log(`[INFO] ${msg}`, meta ? JSON.stringify(meta) : ""),
    warn: (msg, meta) => console.log(`[WARN] ${msg}`, meta ? JSON.stringify(meta) : ""),
    error: (msg, meta) => console.log(`[ERROR] ${msg}`, meta ? JSON.stringify(meta) : "")
  };
  
  const decisions = new DecisionRepository(settings.databasePath);
  const orders = new OrderRepository(settings.databasePath);
  const wishlist = new WishlistRepository(settings.databasePath);
  const location = new LocationRepository(settings.databasePath);
  decisions.initialize(); orders.initialize(); wishlist.initialize(); location.initialize();
  
  const catalogProvider = new AuthorizedDataAggregatorProvider(settings.apiEndpoint!, settings.apiKey!, settings.apiTimeoutMs);
  
  const originalMatcher = new LocalProductMatcher();
  const traceMatcher = {
    select: (wishlistItem, candidates) => {
      console.log(`\n[TRACE] LocalProductMatcher called with WishlistItem: ${JSON.stringify(wishlistItem)}`);
      console.log(`[TRACE] Candidates count: ${candidates.length}`);
      
      const target = candidates.find(c => c.sku === "774440");
      if (target) {
        console.log(`[TRACE] Target item 774440 found in candidates: ${JSON.stringify(target)}`);
      }
      
      const selected = originalMatcher.select(wishlistItem, candidates);
      console.log(`[TRACE] Matcher Selected: ${selected ? JSON.stringify(selected) : "None"}`);
      if (selected) {
         const score = originalMatcher['calculateScore'](wishlistItem, selected);
         console.log(`[TRACE] Matcher Score for selected: ${score}`);
      }
      return selected;
    }
  };
  
  const notificationProvider = settings.notificationProvider === "telegram" && settings.telegramBotToken && settings.telegramChatId
    ? new TelegramNotificationProvider(settings.telegramBotToken, settings.telegramChatId)
    : new MockNotificationProvider({ info: () => {} } as any);
  
  const traceNotification = {
    notify: async (msg) => {
      console.log(`\n[TRACE] Telegram notification triggered: ${msg.substring(0, 150)}...`);
      await notificationProvider.notify(msg);
    }
  };
  
  const service = new SafeAutomationService(catalogProvider, catalogProvider, traceMatcher, new PurchaseRules(settings.eligibilityLimits), decisions, orders, location, logger);
  const orderService = new OrderService(orders, new MockPaymentProvider(), new MockOrderSubmissionProvider(), logger);
  const worker = new WishlistWorker(wishlist, service, orderService, logger);
  const monitor = new WishlistMonitor(wishlist, catalogProvider, catalogProvider, traceMatcher, traceNotification, location, settings.databasePath, logger);
  monitor.initialize();
  
  console.log("\n--- STARTING TRACE RUN ---");
  const wlItems = wishlist.list();
  console.log(`[TRACE] Loaded Wishlist Items: ${JSON.stringify(wlItems, null, 2)}`);
  
  // get previous state before monitor run
  const db = require("node:sqlite").DatabaseSync;
  const sqlite = new db(settings.databasePath);
  let previousState = "NOT_FOUND";
  try {
     const row = sqlite.prepare(`SELECT availability_state FROM monitor_state WHERE wishlist_item_id = ?`).get(wlItems[0].id) as any;
     if (row) previousState = row.availability_state;
  } catch (e) {}
  console.log(`[TRACE] Previous availability state: ${previousState}`);
  
  console.log(`\n--- WORKER RUN ---`);
  const results = await worker.runOnce();
  console.log(`[TRACE] Worker Decisions Made: ${results.length}`);
  console.log(JSON.stringify(results, null, 2));
  
  console.log(`\n--- MONITOR RUN ---`);
  await monitor.runOnce();
  
  let currentState = "NOT_FOUND";
  try {
     const row = sqlite.prepare(`SELECT availability_state FROM monitor_state WHERE wishlist_item_id = ?`).get(wlItems[0].id) as any;
     if (row) currentState = row.availability_state;
  } catch (e) {}
  console.log(`[TRACE] Current availability state: ${currentState}`);
  console.log(`[TRACE] Transition detected: ${previousState} -> ${currentState}`);
}

trace().catch(e => console.error(e));
