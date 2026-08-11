import type { CatalogItem, Decision, EligibilityLimits, WishlistItem } from "../models.js";
import { DecisionReason } from "../models.js";

const trustedEligibilityDecisions = new WeakSet<object>();

export interface FinalizedOrderHistory {
  finalizedSpendingBetween(start: Date, end: Date): number;
  latestFinalizedForWishlist(wishlistItemId: string): Date | undefined;
  latestFinalizedForProduct(productIdentifier: string): Date | undefined;
}

/** Runtime integrity boundary: only decisions issued by PurchaseRules are accepted by OrderService. */
export function isEligibilityDecision(value: unknown): value is Decision {
  return typeof value === "object" && value !== null && trustedEligibilityDecisions.has(value);
}

/** Deterministic local eligibility rules. Approval never executes a purchase. */
export class PurchaseRules {
  public constructor(private readonly limits: EligibilityLimits) {}

  public evaluate(wishlistItem: WishlistItem, item: CatalogItem | undefined, history: FinalizedOrderHistory, now: Date): Decision {
    const base = { wishlistItemId: wishlistItem.id, productIdentifier: wishlistItem.productIdentifier, quantity: wishlistItem.quantity, decidedAt: now };
    const reject = (reason: DecisionReason, selectedItem?: CatalogItem, orderValuePaise?: number): Decision => this.issue({
      ...base, approved: false, reason, item: selectedItem, unitPricePaise: selectedItem?.pricePaise, orderValuePaise,
    });
    if (!wishlistItem.enabled) return reject(DecisionReason.DISABLED);
    if (!isValidWishlistItem(wishlistItem)) return reject(DecisionReason.INVALID_PROVIDER_DATA);
    if (item === undefined) return reject(DecisionReason.PRODUCT_NOT_FOUND);
    if (!isValidCatalogItem(item)) return reject(DecisionReason.INVALID_PROVIDER_DATA);
    if (!item.available || item.availableQuantity === 0) return reject(DecisionReason.OUT_OF_STOCK, item);
    if (item.availableQuantity < wishlistItem.quantity) return reject(DecisionReason.INSUFFICIENT_QUANTITY, item);
    if (item.pricePaise > wishlistItem.maximumUnitPricePaise) return reject(DecisionReason.PRICE_TOO_HIGH, item);
    const orderValuePaise = item.pricePaise * wishlistItem.quantity;
    if (!Number.isSafeInteger(orderValuePaise) || orderValuePaise < 0) return reject(DecisionReason.INVALID_PROVIDER_DATA, item);
    if (orderValuePaise > this.limits.maximumOrderValuePaise) return reject(DecisionReason.MAX_ORDER_VALUE_EXCEEDED, item, orderValuePaise);
    if (history.finalizedSpendingBetween(startOfDay(now), now) + orderValuePaise > this.limits.dailySpendingLimitPaise) return reject(DecisionReason.DAILY_BUDGET_EXCEEDED, item, orderValuePaise);
    if (history.finalizedSpendingBetween(startOfMonth(now), now) + orderValuePaise > this.limits.monthlySpendingLimitPaise) return reject(DecisionReason.MONTHLY_BUDGET_EXCEEDED, item, orderValuePaise);
    if (isWithinMinutes(history.latestFinalizedForWishlist(wishlistItem.id), now, wishlistItem.cooldownMinutes)) return reject(DecisionReason.COOLDOWN_ACTIVE, item, orderValuePaise);
    if (isWithinMinutes(history.latestFinalizedForProduct(wishlistItem.productIdentifier), now, this.limits.duplicateOrderWindowMinutes)) return reject(DecisionReason.DUPLICATE_ORDER, item, orderValuePaise);
    return this.issue({ ...base, approved: true, reason: DecisionReason.APPROVED, item, unitPricePaise: item.pricePaise, orderValuePaise });
  }

  public rejectInvalidProviderData(wishlistItem: WishlistItem, now: Date): Decision {
    return this.issue({ wishlistItemId: wishlistItem.id, productIdentifier: wishlistItem.productIdentifier, quantity: wishlistItem.quantity, decidedAt: now, approved: false, reason: DecisionReason.INVALID_PROVIDER_DATA });
  }

  private issue(decision: Decision): Decision { trustedEligibilityDecisions.add(decision); return decision; }
}

export function issueTestDecision(decision: Decision): Decision { trustedEligibilityDecisions.add(decision); return decision; }

function isValidWishlistItem(item: WishlistItem): boolean {
  return Number.isSafeInteger(item.quantity) && item.quantity > 0 && Number.isSafeInteger(item.maximumUnitPricePaise) && item.maximumUnitPricePaise >= 0 && Number.isSafeInteger(item.cooldownMinutes) && item.cooldownMinutes >= 0;
}
function isValidCatalogItem(item: CatalogItem): boolean {
  return typeof item.sku === "string" && item.sku.length > 0 && typeof item.name === "string" && item.name.length > 0 && Number.isSafeInteger(item.pricePaise) && item.pricePaise >= 0 && typeof item.available === "boolean" && Number.isSafeInteger(item.availableQuantity) && item.availableQuantity >= 0;
}
function isWithinMinutes(previous: Date | undefined, now: Date, minutes: number): boolean { return previous !== undefined && now.getTime() - previous.getTime() < minutes * 60_000; }
function startOfDay(now: Date): Date { return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())); }
function startOfMonth(now: Date): Date { return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)); }
