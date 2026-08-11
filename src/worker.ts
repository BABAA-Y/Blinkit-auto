import type { WishlistEvaluationWorkflow } from "./app.js";
import type { Logger } from "./logging.js";
import type { Decision } from "./models.js";
import type { OrderService } from "./orders/service.js";
import type { WishlistRepository } from "./storage/wishlist.js";

/** Runs the complete local mock-catalog eligibility workflow once. */
export class WishlistWorker {
  public constructor(
    private readonly wishlistRepository: WishlistRepository,
    private readonly automationService: WishlistEvaluationWorkflow,
    private readonly orderService: OrderService,
    private readonly logger: Logger,
  ) {}

  public runOnce(now = new Date()): Decision[] {
    const wishlistItems = this.wishlistRepository.list();
    const decisions = this.automationService.evaluateWishlist(wishlistItems, now);
    for (const decision of decisions) {
      const order = this.orderService.process(decision);
      this.logger.info("Worker recorded local decision", {
        wishlistItemId: decision.wishlistItemId, productIdentifier: decision.productIdentifier,
        approved: decision.approved, reason: decision.reason, orderStatus: order.status,
      });
    }
    return decisions;
  }
}
