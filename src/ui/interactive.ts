import prompts from "prompts";
import { randomUUID } from "node:crypto";
import type { WishlistRepository } from "../storage/wishlist.js";
import type { LocationRepository } from "../storage/location.js";
import type { SettingsRepository } from "../storage/settings.js";
import type { TerminalUI } from "./output.js";
import type { Settings } from "../config.js";
import type { Logger } from "../logging.js";
import { WishlistScheduler } from "../scheduler.js";

export async function startInteractiveMenu(
  wishlist: WishlistRepository,
  location: LocationRepository,
  appSettings: SettingsRepository,
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
    
    const isLinked = !!appSettings.get("telegram_linked_user_id");
    const hasLocal = !!(settings.telegramBotToken && settings.telegramChatId);
    let tgStatus = "Disabled";
    
    if (settings.serverUrl) {
      tgStatus = isLinked ? "Enabled" : "Available / Not Connected";
    } else if (hasLocal) {
      tgStatus = "Enabled";
    }
    
    if (tgStatus === "Enabled" && settings.notificationProvider !== "telegram") {
      tgStatus = "Configured (Disabled via provider setting)";
    } else if (tgStatus === "Enabled") {
      tgStatus = "Enabled";
    } else if (tgStatus === "Available / Not Connected" && settings.notificationProvider !== "telegram") {
       tgStatus = "Available / Not Connected (Disabled via provider setting)";
    }

    // Exact matching for prompt requirements when provider is telegram:
    if (settings.notificationProvider === "telegram") {
      if (settings.serverUrl) {
         tgStatus = isLinked ? "Enabled" : "Available / Not Connected";
      } else if (hasLocal) {
         tgStatus = "Enabled";
      } else {
         tgStatus = "Disabled";
      }
    }
    
    console.log(`📱 Telegram Notifications: ${tgStatus}\n`);
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
          let tgStatus = "Disabled";
          const isLinked = !!appSettings.get("telegram_linked_user_id");
          const hasLocal = !!(settings.telegramBotToken && settings.telegramChatId);
          if (settings.notificationProvider === "telegram") {
            if (settings.serverUrl) {
              tgStatus = isLinked ? "Enabled" : "Available / Not Connected";
            } else if (hasLocal) {
              tgStatus = "Enabled";
            }
          }
          console.log(`📱 Telegram: ${tgStatus}\n`);
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
        while (true) {
          console.clear();
          console.log("\n╔══════════════════════════════════════════════╗");
          console.log("║                  SETTINGS                    ║");
          console.log("╚══════════════════════════════════════════════╝\n");
          
          const isLinked = !!appSettings.get("telegram_linked_user_id") || !!settings.telegramBotToken;
          
          console.log(`Monitoring Interval: ${settings.schedulerIntervalMs}ms (${Math.round(settings.schedulerIntervalMs / 60000)} minutes)`);
          console.log(`Notification Provider: ${settings.notificationProvider}`);
          console.log(`Telegram Configured: ${isLinked ? "Yes" : "No"}`);
          console.log(`Database Location: ${settings.databasePath}\n`);

          const { setAction } = await prompts({
            type: "select",
            name: "setAction",
            message: "Settings Menu",
            choices: [
              { title: "Connect Telegram", value: "telegram" },
              { title: "Test Telegram Notification", value: "test_notification" },
              { title: "Back to Main Menu", value: "back" }
            ]
          });

          if (!setAction || setAction === "back") {
            break;
          }

          if (setAction === "telegram") {
            if (settings.serverUrl) {
              ui.info("Requesting linking session from server...");
              try {
                const url = settings.serverUrl.endsWith("/") ? settings.serverUrl.slice(0, -1) : settings.serverUrl;
                const res = await fetch(`${url}/api/link/session`, { method: "POST" });
                if (!res.ok) throw new Error("Failed to get linking session");
                const { linkingCode, botUsername } = await res.json();
                
                const link = `https://t.me/${botUsername}?start=${linkingCode}`;
                console.log("\n" + "=".repeat(60));
                console.log(`1. Open this link in Telegram:\n   ${link}`);
                console.log("2. Press the START button in the bot chat.");
                console.log("=".repeat(60) + "\n");
                
                ui.info("Waiting for you to complete linking... (Press Ctrl+C to cancel)");
                
                let linkedUserId: string | null = null;
                for (let i = 0; i < 60; i++) { // wait up to 5 minutes (60 * 5s)
                  const statusRes = await fetch(`${url}/api/link/status/${linkingCode}`);
                  if (statusRes.ok) {
                    const statusData = await statusRes.json();
                    if (statusData.linked) {
                      linkedUserId = statusData.userToken;
                      break;
                    }
                  }
                  await new Promise(r => setTimeout(r, 5000));
                }

                if (linkedUserId) {
                  appSettings.set("telegram_linked_user_id", linkedUserId);
                  console.log("\n✓ Telegram connected successfully");
                  console.log("✓ Notifications enabled (Make sure BLINKIT_AUTO_NOTIFICATION_PROVIDER=telegram is set)\n");
                } else {
                  ui.error("Linking timed out. Please try again.");
                }
              } catch (err: any) {
                ui.error(`Error during linking: ${err.message}`);
              }
            } else if (settings.telegramBotToken) {
              ui.info("Telegram is already configured locally via .env (TELEGRAM_BOT_TOKEN).");
            } else {
              ui.error("Telegram is not configured. Please set BLINKIT_AUTO_SERVER_URL or TELEGRAM_BOT_TOKEN in .env.");
            }
            await waitForUser();
          } else if (setAction === "test_notification") {
            const userToken = appSettings.get("telegram_linked_user_id");
            if (settings.serverUrl && userToken) {
              const url = settings.serverUrl.endsWith("/") ? settings.serverUrl.slice(0, -1) : settings.serverUrl;
              ui.info(`Sending test notification via ${url}/api/notify ...`);
              try {
                const res = await fetch(`${url}/api/notify`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ userToken, message: "🧪 This is a test notification from Blinkit-Auto." })
                });
                if (res.ok) {
                  ui.success(`Test notification sent successfully! (HTTP ${res.status})`);
                } else {
                  ui.error(`Failed to send test notification. HTTP ${res.status}`);
                  try {
                    const body = await res.json();
                    if (body.error) ui.error(`Error details: ${body.error}`);
                  } catch { }
                }
              } catch (e: any) {
                ui.error(`Network error sending test notification: ${e.message}`);
              }
            } else if (settings.telegramBotToken && settings.telegramChatId) {
              ui.info(`Sending test notification directly to Telegram API...`);
              try {
                const res = await fetch(`https://api.telegram.org/bot${settings.telegramBotToken}/sendMessage`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ chat_id: settings.telegramChatId, text: "🧪 This is a test notification from Blinkit-Auto." })
                });
                if (res.ok) {
                  ui.success(`Test notification sent successfully! (HTTP ${res.status})`);
                } else {
                  ui.error(`Failed to send test notification. HTTP ${res.status}`);
                }
              } catch (e: any) {
                ui.error(`Network error sending test notification: ${e.message}`);
              }
            } else {
              ui.error("Cannot test notification: Telegram is not fully configured or linked.");
            }
            await waitForUser();
          }
        }
        break;
      }
    }
  }
}

async function waitForUser() {
  await prompts({ type: "text", name: "continue", message: "Press Enter to continue..." });
}
