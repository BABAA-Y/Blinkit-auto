import { randomUUID } from "node:crypto";
import { isEligibilityDecision } from "../automation/rules.js";
import type { OrderSubmissionProvider } from "../integrations/orders.js";
import type { Logger } from "../logging.js";
import { DecisionReason, OrderStatus, type Decision, type OrderRecord } from "../models.js";
import type { PaymentProvider } from "../payments/provider.js";
import { OrderRepository, type NewOrderRecord } from "../storage/orders.js";

/** Local mock order boundary. Only trusted PurchaseRules decisions can reach payment/submission. */
export class OrderService {
  public constructor(private readonly orders: OrderRepository, private readonly paymentProvider: PaymentProvider, private readonly submissionProvider: OrderSubmissionProvider, private readonly logger: Logger) {}

  public process(decision: Decision): OrderRecord {
    if (!isEligibilityDecision(decision)) return this.recordRejected(decision, DecisionReason.INVALID_ELIGIBILITY_DECISION);
    const base = this.baseOrder(decision);
    if (!decision.approved || decision.reason !== DecisionReason.APPROVED || decision.item === undefined || decision.orderValuePaise === undefined || decision.unitPricePaise === undefined) {
      return this.recordRejected(decision, decision.reason);
    }
    const idempotencyKey = this.idempotencyKey(decision);
    const pending: NewOrderRecord = { ...base, idempotencyKey, status: OrderStatus.PROCESSING };
    if (!this.orders.claim(pending, decision.decidedAt)) {
      return this.record({ ...base, idempotencyKey: `duplicate-${randomUUID()}`, status: OrderStatus.DUPLICATE });
    }
    try {
      const payment = this.paymentProvider.authorize(decision.orderValuePaise, idempotencyKey);
      if (!payment.approved) return this.complete(idempotencyKey, OrderStatus.PAYMENT_FAILED, payment.reference);
      try {
        const submission = this.submissionProvider.submit({
          productIdentifier: decision.productIdentifier, productName: decision.item.name, quantity: decision.quantity,
          unitPricePaise: decision.unitPricePaise, totalPaise: decision.orderValuePaise, paymentReference: payment.reference, idempotencyKey,
        });
        try {
          return this.complete(idempotencyKey, OrderStatus.SUBMITTED, payment.reference, submission.reference);
        } catch (error) {
          this.logger.error("Mock submission succeeded but local finalization failed; retry is required", { idempotencyKey, error: diagnosticMessage(error) });
          throw error;
        }
      } catch (error) {
        return this.complete(idempotencyKey, OrderStatus.SUBMISSION_FAILED, payment.reference);
      }
    } catch (error) {
      return this.complete(idempotencyKey, OrderStatus.PAYMENT_FAILED);
    }
  }

  private complete(key: string, status: OrderStatus, paymentReference?: string, submissionReference?: string): OrderRecord {
    const record = this.orders.complete(key, status, paymentReference, submissionReference);
    this.logger.info("Recorded local mock order", { productIdentifier: record.productIdentifier, status: record.status, reason: record.reason });
    return record;
  }
  private recordRejected(decision: Decision, reason: DecisionReason): OrderRecord {
    return this.record({ ...this.baseOrder(decision, reason, false), idempotencyKey: `rejected-${randomUUID()}`, status: OrderStatus.REJECTED });
  }
  private record(order: NewOrderRecord): OrderRecord {
    const record = this.orders.recordRejected(order);
    this.logger.info("Recorded local mock order", { productIdentifier: record.productIdentifier, status: record.status, reason: record.reason });
    return record;
  }
  private baseOrder(decision: Decision, reason = decision.reason, approved = decision.approved): Omit<NewOrderRecord, "idempotencyKey" | "status"> {
    return { wishlistItemId: decision.wishlistItemId, productIdentifier: decision.productIdentifier, productName: decision.item?.name,
      quantity: Number.isSafeInteger(decision.quantity) && decision.quantity > 0 ? decision.quantity : 0,
      unitPricePaise: decision.unitPricePaise, totalPaise: decision.orderValuePaise, decision: approved, reason, timestamp: decision.decidedAt };
  }
  private idempotencyKey(decision: Decision): string {
    return `order:${decision.wishlistItemId}:${decision.productIdentifier}:${decision.quantity}:${decision.unitPricePaise}`;
  }
}

function diagnosticMessage(error: unknown): string { return error instanceof Error ? `${error.name}: ${error.message}` : String(error); }
