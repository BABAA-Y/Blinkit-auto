import type { ItemSelector } from "./ai/decision.js";
import { PurchaseRules, type FinalizedOrderHistory } from "./automation/rules.js";
import type { AvailabilityProvider, ProductSearchProvider } from "./integrations/providers.js";
import type { Logger } from "./logging.js";
import type { Decision, WishlistItem } from "./models.js";
import { DecisionRepository } from "./storage/sqlite.js";
import type { LocationRepository } from "./storage/location.js";

/** Interface consumed by workers; implementations are configured with provider interfaces. */
export interface WishlistEvaluationWorkflow {
  evaluateWishlist(wishlistItems: readonly WishlistItem[], now?: Date): Decision[];
}

/** Orchestrates local eligibility evaluation only; it never purchases anything. */
export class SafeAutomationService implements WishlistEvaluationWorkflow {
  public constructor(
    private readonly catalog: ProductSearchProvider,
    private readonly availability: AvailabilityProvider,
    private readonly selector: ItemSelector,
    private readonly rules: PurchaseRules,
    private readonly decisions: DecisionRepository,
    private readonly finalizedOrders: FinalizedOrderHistory,
    private readonly location: LocationRepository,
    private readonly logger: Logger,
  ) {}

  public evaluateWishlistItem(wishlistItem: WishlistItem, now = new Date()): Decision {
    let decision: Decision;
    try {
      const deliveryLocation = this.location.get();
      const candidates = this.catalog.searchProducts(wishlistItem.desiredProductName, deliveryLocation);
      const selectedItem = this.selector.select(wishlistItem, candidates);
      
      const currentAvailability = selectedItem === undefined ? undefined : this.availability.getAvailability(selectedItem.sku, deliveryLocation);
      const item = selectedItem === undefined ? undefined : { ...selectedItem, available: currentAvailability?.available ?? false, availableQuantity: currentAvailability?.availableQuantity ?? 0 };
      decision = this.rules.evaluate(wishlistItem, item, this.finalizedOrders, now);
    } catch (error) {
      this.logger.warn("Provider data rejected", { error: diagnosticMessage(error), desiredProductName: wishlistItem.desiredProductName });
      decision = this.rules.rejectInvalidProviderData(wishlistItem, now);
    }
    this.decisions.record(decision);
    this.logger.info("Recorded local eligibility decision", { approved: decision.approved, reason: decision.reason });
    return decision;
  }

  public evaluateWishlist(wishlistItems: readonly WishlistItem[], now = new Date()): Decision[] {
    return wishlistItems.map((item) => this.evaluateWishlistItem(item, now));
  }
}

function diagnosticMessage(error: unknown): string { return error instanceof Error ? `${error.name}: ${error.message}` : String(error); }
