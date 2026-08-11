import type { CatalogItem } from "../models.js";
import type { CatalogAvailabilityProvider, ProductAvailability } from "./providers.js";

/** Offline catalog implementation for safe local development and tests. It never contacts Blinkit. */
export class MockBlinkitCatalog implements CatalogAvailabilityProvider {
  private readonly items: readonly CatalogItem[] = [
    { sku: "mock-banana-1", name: "Bananas (6 pcs)", pricePaise: 4500, available: true, availableQuantity: 10 },
    { sku: "mock-milk-1", name: "Milk (1 L)", pricePaise: 6800, available: true, availableQuantity: 5 },
    { sku: "mock-milk-2", name: "Organic Milk (1 L)", pricePaise: 16000, available: false, availableQuantity: 0 },
  ];

  public lookupProducts(query: string): readonly CatalogItem[] {
    const normalized = query.toLocaleLowerCase();
    return this.items.filter((item) =>
      item.sku.toLocaleLowerCase().includes(normalized) || item.name.toLocaleLowerCase().includes(normalized),
    );
  }

  public getAvailability(productIdentifier: string): ProductAvailability | undefined {
    const item = this.items.find((candidate) => candidate.sku === productIdentifier);
    return item === undefined ? undefined : {
      productIdentifier: item.sku, available: item.available, availableQuantity: item.availableQuantity,
    };
  }
}
