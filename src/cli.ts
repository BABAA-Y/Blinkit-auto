import { parseNonNegativeMoneyToPaise } from "./config.js";
import type { Logger } from "./logging.js";
import type { WishlistItem } from "./models.js";
import type { WishlistRepository } from "./storage/wishlist.js";
import type { MockBlinkitCatalog } from "./integrations/blinkit.js";
import type { LocationRepository } from "./storage/location.js";
import type { TerminalUI } from "./ui/output.js";
import { formatBoolean, formatCurrencyPaise } from "./ui/formatting.js";

export function runWishlistCommand(args: readonly string[], repository: WishlistRepository, ui: TerminalUI): void {
  const [operation, ...values] = args;
  switch (operation) {
    case "list": {
      requireArgumentCount(values, 0, "wishlist list");
      const items = repository.list();
      ui.header("Local Wishlist");
      ui.printTable(
        ["ID", "Product", "Qty", "Max Price", "Cooldown", "Enabled"],
        items.map(i => [
          i.id,
          `${i.productName} (${i.productIdentifier})`,
          String(i.quantity),
          formatCurrencyPaise(i.maximumUnitPricePaise),
          `${i.cooldownMinutes}m`,
          formatBoolean(i.enabled, "Enabled", "Disabled")
        ])
      );
      return;
    }
    case "add": {
      if (values.length !== 6 && values.length !== 7) throw new Error(wishlistUsage());
      const [id, productIdentifier, productName, quantity, maximumUnitPrice, cooldown, enabled = "enabled"] = values;
      repository.save({
        id: requireValue(id, "id"), productIdentifier: requireValue(productIdentifier, "product identifier"),
        productName: requireValue(productName, "product name"), quantity: positiveInteger(requireValue(quantity, "quantity"), "quantity"),
        maximumUnitPricePaise: parseNonNegativeMoneyToPaise(requireValue(maximumUnitPrice, "maximum unit price"), "maximum unit price"),
        cooldownMinutes: nonNegativeInteger(requireValue(cooldown, "cooldown"), "cooldown"), enabled: parseEnabled(enabled),
      } satisfies WishlistItem);
      ui.success(`Wishlist item saved: ${id}`);
      return;
    }
    case "remove":
      changeState(repository.remove(requireSingleValue(values, "wishlist remove <id>")), "remove", requireSingleValue(values, "wishlist remove <id>"), ui);
      return;
    case "enable":
      changeState(repository.setEnabled(requireSingleValue(values, "wishlist enable <id>"), true), "enable", requireSingleValue(values, "wishlist enable <id>"), ui);
      return;
    case "disable":
      changeState(repository.setEnabled(requireSingleValue(values, "wishlist disable <id>"), false), "disable", requireSingleValue(values, "wishlist disable <id>"), ui);
      return;
    default:
      throw new Error(wishlistUsage());
  }
}

export function cliUsage(): string {
  return "Usage: npm start -- [run-once|run|status|wishlist list|wishlist add <id> <product-id> <product-name> <quantity> <max-unit-price> <cooldown-minutes> [enabled|disabled]|wishlist remove <id>|wishlist enable <id>|wishlist disable <id>|catalog list|catalog set-availability <sku> <true|false> <quantity> [pincode]|location set <pincode> [city] [state]|location show]";
}

export function runCatalogCommand(args: readonly string[], catalog: MockBlinkitCatalog, ui: TerminalUI): void {
  const [operation, ...values] = args;
  switch (operation) {
    case "list": {
      const items = catalog.lookupProducts("");
      ui.header("Mock Catalog");
      ui.printTable(
        ["SKU", "Name", "Price", "Available", "Qty", "Location"],
        items.map(i => [
          i.sku,
          i.name,
          formatCurrencyPaise(i.pricePaise),
          formatBoolean(i.available),
          String(i.availableQuantity),
          (i as any).pincode || "*"
        ])
      );
      return;
    }
    case "set-availability": {
      if (values.length !== 3 && values.length !== 4) throw new Error("Usage: npm start -- catalog set-availability <sku> <true|false> <quantity> [pincode]");
      const [sku, availableStr, quantityStr, pincode = "*"] = values;
      const available = availableStr === "true";
      const quantity = nonNegativeInteger(quantityStr!, "quantity");
      const changed = catalog.setAvailability(sku!, available, quantity, pincode);
      if (!changed) throw new Error(`Catalog item not found: ${sku}`);
      ui.success(`Catalog availability updated: ${sku} is now ${available ? "available" : "unavailable"} (${quantity} in stock) for location ${pincode}`);
      return;
    }
    default:
      throw new Error(cliUsage());
  }
}

export function runLocationCommand(args: readonly string[], repository: LocationRepository, ui: TerminalUI): void {
  const [operation, ...values] = args;
  switch (operation) {
    case "show": {
      const loc = repository.get();
      if (!loc) ui.warning("No delivery location configured");
      else {
        ui.header("Configured Delivery Location");
        ui.printObject({ ...loc });
      }
      return;
    }
    case "set": {
      if (values.length < 1 || values.length > 3) throw new Error("Usage: npm start -- location set <pincode> [city] [state]");
      const [pincode, city, state] = values;
      repository.set({ pincode: pincode!, city, state });
      ui.success(`Delivery location updated: ${pincode} ${city || ""} ${state || ""}`.trim());
      return;
    }
    default:
      throw new Error(cliUsage());
  }
}

function wishlistUsage(): string { return cliUsage(); }
function requireValue(value: string | undefined, name: string): string { if (value === undefined || value.trim() === "") throw new Error(`${name} is required`); return value; }
function requireArgumentCount(values: readonly string[], expected: number, usage: string): void { if (values.length !== expected) throw new Error(`Usage: npm start -- ${usage}`); }
function requireSingleValue(values: readonly string[], usage: string): string { requireArgumentCount(values, 1, usage); return requireValue(values[0], "id"); }
function positiveInteger(value: string, name: string): number { const number = Number(value); if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${name} must be a positive integer`); return number; }
function nonNegativeInteger(value: string, name: string): number { const number = Number(value); if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${name} must be a non-negative integer`); return number; }
function parseEnabled(value: string): boolean { if (value === "enabled") return true; if (value === "disabled") return false; throw new Error("enabled state must be enabled or disabled"); }
function changeState(changed: boolean, action: string, id: string, ui: TerminalUI): void { if (!changed) throw new Error(`Wishlist item not found: ${id}`); ui.success(`Wishlist item ${action}d: ${id}`); }
