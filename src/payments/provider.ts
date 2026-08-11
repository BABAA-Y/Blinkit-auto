/** Payment boundary. Implementations must never accept or retain credentials. */
export interface PaymentProvider {
  authorize(amountPaise: number, idempotencyKey: string): PaymentAuthorization;
}

export interface PaymentAuthorization {
  approved: boolean;
  reference: string;
}

/** Safe local default: payment execution is deliberately unavailable. */
export class LocalPaymentDisabled implements PaymentProvider {
  public authorize(_amountPaise: number, _idempotencyKey: string): never {
    throw new Error("Payment execution is disabled in the local mock implementation");
  }
}

/** Local test double: it records no credentials and never charges money. */
export class MockPaymentProvider implements PaymentProvider {
  public readonly authorizedAmounts: number[] = [];
  private readonly authorizations = new Map<string, PaymentAuthorization>();

  public authorize(amountPaise: number, idempotencyKey: string): PaymentAuthorization {
    if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) throw new Error("Mock payment amount must be a positive integer");
    const existing = this.authorizations.get(idempotencyKey);
    if (existing !== undefined) return existing;
    this.authorizedAmounts.push(amountPaise);
    const authorization = { approved: true, reference: `mock-payment-${this.authorizedAmounts.length}` };
    this.authorizations.set(idempotencyKey, authorization);
    return authorization;
  }
}
