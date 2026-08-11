import { parseNonNegativeMoneyToPaise } from "./config.js";
import type { Logger } from "./logging.js";
import type { WishlistItem } from "./models.js";
import type { WishlistRepository } from "./storage/wishlist.js";
import type { MockBlinkitCatalog } from "./integrations/blinkit.js";

export function runWishlistCommand(args: readonly string[], repository: WishlistRepository, logger: Logger): void {
  const [operation, ...values] = args;
  switch (operation) {
    case "list":
      requireArgumentCount(values, 0, "wishlist list");
      logger.info("Local wishlist", { items: repository.list() });
      return;
    case "add": {
      if (values.length !== 6 && values.length !== 7) throw new Error(wishlistUsage());
      const [id, productIdentifier, productName, quantity, maximumUnitPrice, cooldown, enabled = "enabled"] = values;
      repository.save({
        id: requireValue(id, "id"), productIdentifier: requireValue(productIdentifier, "product identifier"),
        productName: requireValue(productName, "product name"), quantity: positiveInteger(requireValue(quantity, "quantity"), "quantity"),
        maximumUnitPricePaise: parseNonNegativeMoneyToPaise(requireValue(maximumUnitPrice, "maximum unit price"), "maximum unit price"),
        cooldownMinutes: nonNegativeInteger(requireValue(cooldown, "cooldown"), "cooldown"), enabled: parseEnabled(enabled),
      } satisfies WishlistItem);
      logger.info("Wishlist item saved", { id });
      return;
    }
    case "remove":
      changeState(repository.remove(requireSingleValue(values, "wishlist remove <id>")), "remove", requireSingleValue(values, "wishlist remove <id>"), logger);
      return;
    case "enable":
      changeState(repository.setEnabled(requireSingleValue(values, "wishlist enable <id>"), true), "enable", requireSingleValue(values, "wishlist enable <id>"), logger);
      return;
    case "disable":
      changeState(repository.setEnabled(requireSingleValue(values, "wishlist disable <id>"), false), "disable", requireSingleValue(values, "wishlist disable <id>"), logger);
      return;
    default:
      throw new Error(wishlistUsage());
  }
}

export function cliUsage(): string {
  return "Usage: npm start -- [run-once|run|status|wishlist list|wishlist add <id> <product-id> <product-name> <quantity> <max-unit-price> <cooldown-minutes> [enabled|disabled]|wishlist remove <id>|wishlist enable <id>|wishlist disable <id>|catalog list|catalog set-availability <sku> <true|false> <quantity>]";
}

export function runCatalogCommand(args: readonly string[], catalog: MockBlinkitCatalog, logger: Logger): void {
  const [operation, ...values] = args;
  switch (operation) {
    case "list":
      logger.info("Mock Catalog", { items: catalog.lookupProducts("") });
      return;
    case "set-availability": {
      requireArgumentCount(values, 3, "catalog set-availability <sku> <true|false> <quantity>");
      const [sku, availableStr, quantityStr] = values;
      const available = availableStr === "true";
      const quantity = nonNegativeInteger(quantityStr!, "quantity");
      const changed = catalog.setAvailability(sku!, available, quantity);
      if (!changed) throw new Error(`Catalog item not found: ${sku}`);
      logger.info("Catalog availability updated", { sku, available, quantity });
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
function changeState(changed: boolean, action: string, id: string, logger: Logger): void { if (!changed) throw new Error(`Wishlist item not found: ${id}`); logger.info(`Wishlist item ${action}d`, { id }); }
