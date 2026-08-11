import { describe, expect, it } from "vitest";
import { MockBlinkitCatalog } from "../src/integrations/blinkit.js";
import { MockOrderSubmissionProvider, type OrderSubmissionProvider } from "../src/integrations/orders.js";
import type { AvailabilityProvider, ProductCatalogProvider } from "../src/integrations/providers.js";

describe("mock provider interfaces", () => {
  it("uses the mock catalog through independent lookup and availability interfaces", async () => {
    const mock = new MockBlinkitCatalog();
    const catalog: ProductCatalogProvider = mock;
    const availability: AvailabilityProvider = mock;
    expect((await catalog.lookupProducts("milk")).map((item) => item.sku).sort()).toEqual(["mock-milk-1", "mock-milk-2"].sort());
    expect(await availability.getAvailability("mock-milk-1")).toMatchObject({ available: true, availableQuantity: 5 });
  });

  it("uses mock order submission only through the submission interface", () => {
    const mock = new MockOrderSubmissionProvider();
    const submission: OrderSubmissionProvider = mock;
    expect(submission.submit({ productIdentifier: "mock-milk-1", productName: "Milk", quantity: 1, unitPricePaise: 6800, totalPaise: 6800, paymentReference: "mock-payment-1", idempotencyKey: "test-idempotency-key" }))
      .toEqual({ reference: "mock-submission-1" });
    expect(mock.submittedOrders).toHaveLength(1);
  });
});
