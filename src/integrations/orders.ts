export interface OrderSubmission {
  productIdentifier: string;
  productName: string;
  quantity: number;
  unitPricePaise: number;
  totalPaise: number;
  paymentReference: string;
  idempotencyKey: string;
}

export interface OrderSubmissionReceipt {
  reference: string;
}

/** Boundary for a future authorized order-submission integration. */
export interface OrderSubmissionProvider {
  submit(order: OrderSubmission): OrderSubmissionReceipt;
}

/** Offline test double. It only keeps orders in memory and never contacts Blinkit. */
export class MockOrderSubmissionProvider implements OrderSubmissionProvider {
  public readonly submittedOrders: OrderSubmission[] = [];
  private readonly receipts = new Map<string, OrderSubmissionReceipt>();

  public submit(order: OrderSubmission): OrderSubmissionReceipt {
    const existing = this.receipts.get(order.idempotencyKey);
    if (existing !== undefined) return existing;
    this.submittedOrders.push(order);
    const receipt = { reference: `mock-submission-${this.submittedOrders.length}` };
    this.receipts.set(order.idempotencyKey, receipt);
    return receipt;
  }
}
