import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockOrderSubmissionProvider } from "../src/integrations/orders.js";
import type { Logger } from "../src/logging.js";
import { DecisionReason, OrderStatus, type Decision } from "../src/models.js";
import { OrderService } from "../src/orders/service.js";
import { MockPaymentProvider } from "../src/payments/provider.js";
import { OrderRepository } from "../src/storage/orders.js";

const directories: string[] = [];
const logger: Logger = { info: () => undefined };
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

function approvedDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    approved: true, reason: DecisionReason.APPROVED, wishlistItemId: "milk-wishlist", productIdentifier: "mock-milk-1",
    quantity: 2, unitPricePaise: 6800, orderValuePaise: 13600,
    item: { sku: "mock-milk-1", name: "Milk (1 L)", pricePaise: 6800, available: true, availableQuantity: 5 },
    decidedAt: new Date("2026-08-11T12:00:00Z"), ...overrides,
  };
}

function orderService(): { service: OrderService; repository: OrderRepository; payment: MockPaymentProvider; submission: MockOrderSubmissionProvider } {
  const directory = mkdtempSync(join(tmpdir(), "blinkit-auto-")); directories.push(directory);
  const repository = new OrderRepository(join(directory, "test.sqlite3")); repository.initialize();
  const payment = new MockPaymentProvider(); const submission = new MockOrderSubmissionProvider();
  return { service: new OrderService(repository, payment, submission, logger), repository, payment, submission };
}

describe("OrderService local mock flow", () => {
  it("submits an approved decision only through mock providers and records all order fields", () => {
    const setup = orderService();
    const result = setup.service.process(approvedDecision());
    expect(result).toMatchObject({ productIdentifier: "mock-milk-1", productName: "Milk (1 L)", quantity: 2, unitPricePaise: 6800, totalPaise: 13600, decision: true, reason: DecisionReason.APPROVED, status: OrderStatus.MOCK_SUBMITTED });
    expect(result.timestamp.toISOString()).toBe("2026-08-11T12:00:00.000Z");
    expect(setup.payment.authorizedAmounts).toEqual([13600]);
    expect(setup.submission.submittedOrders).toHaveLength(1);
    expect(setup.repository.list()).toEqual([result]);
  });

  it("refuses rejected eligibility without authorizing payment or submitting an order", () => {
    const setup = orderService();
    const result = setup.service.process(approvedDecision({ approved: false, reason: DecisionReason.OUT_OF_STOCK, item: undefined, unitPricePaise: undefined, orderValuePaise: undefined }));
    expect(result.status).toBe(OrderStatus.REJECTED);
    expect(setup.payment.authorizedAmounts).toEqual([]);
    expect(setup.submission.submittedOrders).toEqual([]);
  });

  it("prevents duplicate order creation after a mock submission", () => {
    const setup = orderService();
    expect(setup.service.process(approvedDecision()).status).toBe(OrderStatus.MOCK_SUBMITTED);
    expect(setup.service.process(approvedDecision({ decidedAt: new Date("2026-08-11T12:01:00Z") })).status).toBe(OrderStatus.DUPLICATE);
    expect(setup.payment.authorizedAmounts).toEqual([13600]);
    expect(setup.submission.submittedOrders).toHaveLength(1);
    expect(setup.repository.list()).toHaveLength(2);
  });
});
