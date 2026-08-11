import { config } from "dotenv";
config();

import { LocalProductMatcher } from "./ai/decision.js";
import { SafeAutomationService } from "./app.js";
import { cliUsage, runCatalogCommand, runLocationCommand, runWishlistCommand } from "./cli.js";
import { PurchaseRules } from "./automation/rules.js";
import { settingsFromEnvironment } from "./config.js";
import { MockBlinkitCatalog } from "./integrations/blinkit.js";
import { MockOrderSubmissionProvider } from "./integrations/orders.js";
import { FileLogger } from "./logging.js";
import { TerminalUI } from "./ui/output.js";
import { OrderService } from "./orders/service.js";
import { MockPaymentProvider } from "./payments/provider.js";
import { WishlistScheduler } from "./scheduler.js";
import { DecisionRepository } from "./storage/sqlite.js";
import { OrderRepository } from "./storage/orders.js";
import { WishlistRepository } from "./storage/wishlist.js";
import { LocationRepository } from "./storage/location.js";
import { WishlistWorker } from "./worker.js";
import { WishlistMonitor } from "./monitor.js";
import { MockNotificationProvider } from "./notifications/mock.js";
import { TelegramNotificationProvider } from "./notifications/telegram.js";

try {
  const settings = settingsFromEnvironment();
  const ui = new TerminalUI();
  const logPath = settings.databasePath.replace(/\.sqlite3$/, "") + ".log";
  const logger = new FileLogger(logPath);
  const decisions = new DecisionRepository(settings.databasePath);
  const orders = new OrderRepository(settings.databasePath);
  const wishlist = new WishlistRepository(settings.databasePath);
  const location = new LocationRepository(settings.databasePath);
  decisions.initialize(); orders.initialize(); wishlist.initialize(); location.initialize();
  const catalogProvider = new MockBlinkitCatalog(settings.databasePath);
  const service = new SafeAutomationService(catalogProvider, catalogProvider, new LocalProductMatcher(), new PurchaseRules(settings.eligibilityLimits), decisions, orders, location, logger);
  const orderService = new OrderService(orders, new MockPaymentProvider(), new MockOrderSubmissionProvider(), logger);
  const worker = new WishlistWorker(wishlist, service, orderService, logger);
  const notificationProvider = settings.notificationProvider === "telegram" && settings.telegramBotToken && settings.telegramChatId
    ? new TelegramNotificationProvider(settings.telegramBotToken, settings.telegramChatId)
    : new MockNotificationProvider(ui);
  const monitor = new WishlistMonitor(wishlist, catalogProvider, catalogProvider, new LocalProductMatcher(), notificationProvider, location, settings.databasePath, logger);
  monitor.initialize();
  const compositeWorker = {
    runOnce: async () => {
      const results = worker.runOnce();
      await monitor.runOnce();
      return results;
    }
  };
  const [command = "run-once", ...args] = process.argv.slice(2);

  switch (command) {
    case "run-once": {
      if (args.length !== 0) throw new Error(cliUsage());
      const results = await compositeWorker.runOnce(); 
      ui.success(`Worker run complete. Decisions made: ${results.length}`); 
      break;
    }
    case "run": {
      if (args.length !== 0) throw new Error(cliUsage());
      const scheduler = new WishlistScheduler(compositeWorker, settings.schedulerIntervalMs, logger);
      const shutdown = (signal: string): void => { ui.info(`Shutdown requested (${signal})`); scheduler.stop(); };
      process.once("SIGINT", () => shutdown("SIGINT")); process.once("SIGTERM", () => shutdown("SIGTERM")); 
      ui.info(`Starting continuous scheduler (interval: ${settings.schedulerIntervalMs}ms). Press Ctrl+C to stop.`);
      scheduler.start(); 
      break;
    }
    case "status":
      if (args.length !== 0) throw new Error(cliUsage());
      ui.header("Local Worker Status");
      ui.printObject({
        "Wishlist Items": wishlist.count(),
        "Decisions Made": decisions.count(),
        "Orders Placed": orders.list().length,
        "Scheduler Interval": `${settings.schedulerIntervalMs}ms`
      });
      break;
    case "wishlist":
      runWishlistCommand(args, wishlist, ui); break;
    case "catalog":
      runCatalogCommand(args, catalogProvider, ui); break;
    case "location":
      runLocationCommand(args, location, ui); break;
    default:
      throw new Error(cliUsage());
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown command error";
  new TerminalUI().error(message);
  process.exitCode = 1;
}
