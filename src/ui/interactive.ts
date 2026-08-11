import prompts from "prompts";
import { randomUUID } from "node:crypto";
import type { WishlistRepository } from "../storage/wishlist.js";
import type { LocationRepository } from "../storage/location.js";
import type { TerminalUI } from "./output.js";
import type { Settings } from "../config.js";
import type { Logger } from "../logging.js";
import { WishlistScheduler } from "../scheduler.js";

export async function startInteractiveMenu(
  wishlist: WishlistRepository,
  location: LocationRepository,
  compositeWorker: { runOnce: () => Promise<any[]> },
  settings: Settings,
  ui: TerminalUI,
  logger: Logger
): Promise<void> {
  // We need to keep a reference to a running scheduler if any
  let scheduler: WishlistScheduler | undefined;

  const showHeader = () => {
    console.clear();
    console.log("╔══════════════════════════════════════════════╗");
    console.log("║              🛒 BLINKIT-AUTO                 ║");
    console.log("║          Wishlist Availability Monitor       ║");
    console.log("╚══════════════════════════════════════════════╝\n");
    
    const loc = location.get();
    const locStr = loc ? `${loc.pincode}${loc.city ? `, ${loc.city}` : ""}${loc.latitude && loc.longitude ? ` [${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}]` : ""}` : "Not configured";
    console.log(`📍 Location: ${locStr}`);
    
    const tgEnabled = settings.notificationProvider === "telegram" && settings.telegramBotToken && settings.telegramChatId;
    console.log(`📱 Telegram Notifications: ${tgEnabled ? "Enabled" : "Disabled"}\n`);
  };

  while (true) {
    showHeader();

    const { action } = await prompts({
      type: "select",
      name: "action",
      message: "Main Menu",
      choices: [
        { title: "1. Add product to wishlist", value: "add" },
        { title: "2. View wishlist", value: "view" },
        { title: "3. Remove product", value: "remove" },
        { title: scheduler?.isRunning ? "4. Stop monitoring" : "4. Start monitoring", value: "monitor" },
        { title: "5. Check now", value: "check" },
        { title: "6. Delivery location", value: "location" },
        { title: "7. Settings", value: "settings" },
        { title: "8. Exit", value: "exit" }
      ]
    });

    if (!action || action === "exit") {
      if (scheduler?.isRunning) scheduler.stop();
      ui.success("Goodbye!");
      break;
    }

    switch (action) {
      case "add": {
        const response = await prompts([
          { type: "text", name: "name", message: "Product name:", validate: (v) => v.trim().length > 0 ? true : "Required" },
          { type: "text", name: "brand", message: "Brand (optional):" },
          { type: "number", name: "maxPrice", message: "Maximum price (₹):", float: true, min: 0, validate: (v) => v >= 0 ? true : "Must be non-negative" },
          { type: "number", name: "quantity", message: "Quantity:", min: 1, validate: (v) => Number.isInteger(v) && v > 0 ? true : "Must be a positive integer" },
          { type: "text", name: "keywords", message: "Keywords (comma separated, optional):" },
          { type: "number", name: "cooldown", message: "Cooldown (minutes):", initial: 60, min: 0, validate: (v) => Number.isInteger(v) && v >= 0 ? true : "Must be non-negative" }
        ]);

        if (response.name === undefined) break; // User cancelled

        const id = randomUUID();
        const maxPricePaise = Math.round(response.maxPrice * 100);
        const keywords = response.keywords ? response.keywords.split(",").map((k: string) => k.trim()).filter(Boolean) : undefined;
        
        wishlist.save({
          id,
          desiredProductName: response.name.trim(),
          brand: response.brand?.trim() || undefined,
          keywords: keywords && keywords.length > 0 ? keywords : undefined,
          maximumUnitPricePaise: maxPricePaise,
          quantity: response.quantity,
          cooldownMinutes: response.cooldown,
          enabled: true
        });

        console.log("\n✓ Product added\n");
        console.log(`Product : ${response.name.trim()}`);
        if (response.brand?.trim()) console.log(`Brand   : ${response.brand.trim()}`);
        console.log(`Max     : ₹${response.maxPrice.toFixed(2)}`);
        console.log(`Quantity: ${response.quantity}`);
        const savedLoc = location.get();
        if (savedLoc) console.log(`Location: ${savedLoc.pincode}`);
        
        await waitForUser();
        break;
      }
      case "view": {
        const items = wishlist.list();
        if (items.length === 0) {
          ui.info("Wishlist is empty.");
        } else {
          ui.printTable(
            ["Product", "Brand", "Max price", "Quantity", "Status", "Cooldown (m)"],
            items.map(item => [
              item.desiredProductName,
              item.brand || "-",
              `₹${(item.maximumUnitPricePaise / 100).toFixed(2)}`,
              item.quantity.toString(),
              item.enabled ? "Enabled" : "Disabled",
              item.cooldownMinutes.toString()
            ])
          );
        }
        await waitForUser();
        break;
      }
      case "remove": {
        const items = wishlist.list();
        if (items.length === 0) {
          ui.info("Wishlist is empty.");
          await waitForUser();
          break;
        }

        const { idToRemove } = await prompts({
          type: "select",
          name: "idToRemove",
          message: "Select product to remove:",
          choices: [
            ...items.map(item => ({ title: `${item.desiredProductName} (₹${(item.maximumUnitPricePaise / 100).toFixed(2)})`, value: item.id })),
            { title: "Cancel", value: "cancel" }
          ]
        });

        if (idToRemove && idToRemove !== "cancel") {
          const { confirm } = await prompts({
            type: "confirm",
            name: "confirm",
            message: "Are you sure you want to remove this item?",
            initial: false
          });
          if (confirm) {
            wishlist.remove(idToRemove);
            ui.success("Product removed from wishlist.");
          }
        }
        await waitForUser();
        break;
      }
      case "monitor": {
        if (scheduler?.isRunning) {
          scheduler.stop();
          ui.success("Monitoring stopped.");
        } else {
          scheduler = new WishlistScheduler(compositeWorker, settings.schedulerIntervalMs, logger);
          scheduler.start();
          console.log("\n✓ Monitor started");
          const loc = location.get();
          console.log(`📍 Location: ${loc ? `${loc.pincode}${loc.latitude && loc.longitude ? ` [${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}]` : ""}` : "Not configured"}`);
          console.log(`⏱ Interval: ${Math.round(settings.schedulerIntervalMs / 60000)} minutes`);
          console.log(`📱 Telegram: ${settings.notificationProvider === "telegram" ? "Enabled" : "Disabled"}\n`);
        }
        await waitForUser();
        break;
      }
      case "check": {
        ui.info("Running manual check...");
        try {
          const results = await compositeWorker.runOnce();
          
          let approved = 0;
          for (const res of results) {
            if (res.approved) approved++;
          }
          
          console.log("\nCheck Summary:");
          console.log(`- Products checked: ${wishlist.list().length}`);
          console.log(`- Local approvals: ${approved}`);
          console.log(`- Total decisions: ${results.length}`);
          console.log("\n(Notifications are sent automatically if newly available)");
          
        } catch (err: any) {
          ui.error(`Check failed: ${err.message}`);
        }
        await waitForUser();
        break;
      }
      case "location": {
        const loc = location.get();
        if (loc) {
          console.log(`\nCurrent Location: ${loc.pincode} ${loc.city ? `(${loc.city})` : ""}${loc.latitude && loc.longitude ? ` [${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}]` : ""}\n`);
        } else {
          console.log(`\nCurrent Location: Not set\n`);
        }
        
        const { update } = await prompts({
          type: "confirm",
          name: "update",
          message: "Update delivery location?",
          initial: false
        });
        
        if (update) {
          const locResponse = await prompts([
            { type: "text", name: "pincode", message: "Pincode:", validate: (v) => v.trim().length > 0 ? true : "Required" },
            { type: "text", name: "city", message: "City (optional):" },
            { type: "text", name: "state", message: "State (optional):" },
            { type: "number", name: "latitude", message: "Latitude (optional):", float: true, validate: (v) => v === undefined || (v >= -90 && v <= 90) ? true : "Must be between -90 and 90" },
            { type: "number", name: "longitude", message: "Longitude (optional):", float: true, validate: (v) => v === undefined || (v >= -180 && v <= 180) ? true : "Must be between -180 and 180" }
          ]);
          if (locResponse.pincode) {
            location.set({
              pincode: locResponse.pincode.trim(),
              city: locResponse.city?.trim() || undefined,
              state: locResponse.state?.trim() || undefined,
              latitude: locResponse.latitude,
              longitude: locResponse.longitude
            });
            ui.success("Location updated successfully.");
          }
        }
        await waitForUser();
        break;
      }
      case "settings": {
        console.log("\nCurrent Settings:");
        console.log(`- Monitoring Interval: ${settings.schedulerIntervalMs}ms (${Math.round(settings.schedulerIntervalMs / 60000)} minutes)`);
        console.log(`- Notification Provider: ${settings.notificationProvider}`);
        console.log(`- Telegram Configured: ${settings.telegramBotToken ? "Yes" : "No"}`);
        console.log(`- Database Location: ${settings.databasePath}\n`);
        
        ui.info("Note: Settings are currently read-only in the UI. Update .env to change them.");
        await waitForUser();
        break;
      }
    }
  }
}

async function waitForUser() {
  await prompts({ type: "text", name: "continue", message: "Press Enter to return to menu..." });
}
