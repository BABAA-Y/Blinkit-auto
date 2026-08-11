import type { CatalogItem } from "../models.js";

export interface ItemSelector {
  select(productIdentifier: string, productName: string, candidates: readonly CatalogItem[]): CatalogItem | undefined;
}

/** Local, deterministic selection; it makes no external AI calls. */
export class SimpleItemSelector implements ItemSelector {
  public select(productIdentifier: string, productName: string, candidates: readonly CatalogItem[]): CatalogItem | undefined {
    const identifier = productIdentifier.toLocaleLowerCase();
    const name = productName.toLocaleLowerCase();
    return candidates
      .filter((item) => item.sku.toLocaleLowerCase() === identifier || item.name.toLocaleLowerCase() === name)
      .sort((left, right) => left.pricePaise - right.pricePaise)[0];
  }
}
