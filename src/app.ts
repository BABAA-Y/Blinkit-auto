import type { ItemSelector } from "./ai/decision.js";
import { PurchaseRules, type FinalizedOrderHistory } from "./automation/rules.js";
import type { AvailabilityProvider, ProductSearchProvider } from "./integrations/providers.js";
import type { Logger } from "./logging.js";
import type { Decision, WishlistItem } from "./models.js";
import { DecisionRepository } from "./storage/sqlite.js";
import type { LocationRepository } from "./storage/location.js";
import { buildSearchQuery } from "./ai/decision.js";

/** Interface consumed by workers; implementations are configured with provider interfaces. */
export interface WishlistEvaluationWorkflow {
  evaluateWishlist(wishlistItems: readonly WishlistItem[], now?: Date): Promise<Decision[]>;
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

  public async evaluateWishlistItem(wishlistItem: WishlistItem, now = new Date()): Promise<Decision> {
    let decision: Decision;
    try {
      const deliveryLocation = this.location.get();
      const searchQuery = buildSearchQuery(wishlistItem);
      const candidates = await this.catalog.searchProducts(searchQuery, deliveryLocation);
      const selectedItem = this.selector.select(wishlistItem, candidates);
      
      const currentAvailability = selectedItem === undefined ? undefined : await this.availability.getAvailability(selectedItem.sku, deliveryLocation);
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

  public async evaluateWishlist(wishlistItems: readonly WishlistItem[], now = new Date()): Promise<Decision[]> {
    return Promise.all(wishlistItems.map((item) => this.evaluateWishlistItem(item, now)));
  }
}

function diagnosticMessage(error: unknown): string { return error instanceof Error ? `${error.name}: ${error.message}` : String(error); }
