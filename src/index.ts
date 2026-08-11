import { SimpleItemSelector } from "./ai/decision.js";
import { SafeAutomationService } from "./app.js";
import { cliUsage, runCatalogCommand, runWishlistCommand } from "./cli.js";
import { PurchaseRules } from "./automation/rules.js";
import { settingsFromEnvironment } from "./config.js";
import { MockBlinkitCatalog } from "./integrations/blinkit.js";
import { MockOrderSubmissionProvider } from "./integrations/orders.js";
import { ConsoleLogger } from "./logging.js";
import { OrderService } from "./orders/service.js";
import { MockPaymentProvider } from "./payments/provider.js";
import { WishlistScheduler } from "./scheduler.js";
import { DecisionRepository } from "./storage/sqlite.js";
import { OrderRepository } from "./storage/orders.js";
import { WishlistRepository } from "./storage/wishlist.js";
import { WishlistWorker } from "./worker.js";
import { WishlistMonitor } from "./monitor.js";
import { MockNotificationProvider } from "./notifications/mock.js";
import { TelegramNotificationProvider } from "./notifications/telegram.js";

try {
  const settings = settingsFromEnvironment();
  const logger = new ConsoleLogger();
  const decisions = new DecisionRepository(settings.databasePath);
  const orders = new OrderRepository(settings.databasePath);
  const wishlist = new WishlistRepository(settings.databasePath);
  decisions.initialize(); orders.initialize(); wishlist.initialize();
  const catalogProvider = new MockBlinkitCatalog(settings.databasePath);
  const service = new SafeAutomationService(catalogProvider, catalogProvider, new SimpleItemSelector(), new PurchaseRules(settings.eligibilityLimits), decisions, orders, logger);
  const orderService = new OrderService(orders, new MockPaymentProvider(), new MockOrderSubmissionProvider(), logger);
  const worker = new WishlistWorker(wishlist, service, orderService, logger);
  const notificationProvider = settings.notificationProvider === "telegram" && settings.telegramBotToken && settings.telegramChatId
    ? new TelegramNotificationProvider(settings.telegramBotToken, settings.telegramChatId)
    : new MockNotificationProvider(logger);
  const monitor = new WishlistMonitor(wishlist, catalogProvider, catalogProvider, new SimpleItemSelector(), notificationProvider, settings.databasePath, logger);
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
      const results = await compositeWorker.runOnce(); logger.info("Worker run complete", { decisions: results.length }); break;
    }
    case "run": {
      if (args.length !== 0) throw new Error(cliUsage());
      const scheduler = new WishlistScheduler(compositeWorker, settings.schedulerIntervalMs, logger);
      const shutdown = (signal: string): void => { logger.info("Shutdown requested", { signal }); scheduler.stop(); };
      process.once("SIGINT", () => shutdown("SIGINT")); process.once("SIGTERM", () => shutdown("SIGTERM")); scheduler.start(); break;
    }
    case "status":
      if (args.length !== 0) throw new Error(cliUsage());
      logger.info("Local worker status", { wishlistItems: wishlist.count(), decisions: decisions.count(), orders: orders.list().length, schedulerIntervalMs: settings.schedulerIntervalMs }); break;
    case "wishlist":
      runWishlistCommand(args, wishlist, logger); break;
    case "catalog":
      runCatalogCommand(args, catalogProvider, logger); break;
    default:
      throw new Error(cliUsage());
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Unknown command error");
  process.exitCode = 1;
}
