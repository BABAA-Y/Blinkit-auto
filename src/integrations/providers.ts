import type { CatalogItem, WishlistItem } from "../models.js";

/** Product lookup boundary. Implementations may only return catalog data. */
export interface ProductCatalogProvider {
  lookupProducts(query: string): readonly CatalogItem[];
}

export interface ProductAvailability {
  productIdentifier: string;
  available: boolean;
  availableQuantity: number;
}

/** Availability boundary, separated from product lookup for future provider flexibility. */
export interface AvailabilityProvider {
  getAvailability(productIdentifier: string): ProductAvailability | undefined;
}

/** A local provider can implement both contracts, but callers depend on each interface separately. */
export interface CatalogAvailabilityProvider extends ProductCatalogProvider, AvailabilityProvider {}

export interface WishlistProvider {
  list(): readonly WishlistItem[] | Promise<readonly WishlistItem[]>;
}

export interface NotificationProvider {
  notify(message: string): Promise<void> | void;
}

