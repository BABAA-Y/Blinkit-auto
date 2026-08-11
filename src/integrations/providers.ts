import type { CatalogItem, DeliveryLocation, WishlistItem } from "../models.js";

export interface ProductSearchProvider {
  searchProducts(query: string, location?: DeliveryLocation): readonly CatalogItem[] | Promise<readonly CatalogItem[]>;
}

/** Product lookup boundary. Implementations may only return catalog data. */
export interface ProductCatalogProvider {
  lookupProducts(query: string): readonly CatalogItem[] | Promise<readonly CatalogItem[]>;
}

export interface ProductAvailability {
  productIdentifier: string;
  available: boolean;
  availableQuantity: number;
  pricePaise?: number;
}

/** Availability boundary, separated from product lookup for future provider flexibility. */
export interface AvailabilityProvider {
  getAvailability(productIdentifier: string, location?: DeliveryLocation): ProductAvailability | undefined | Promise<ProductAvailability | undefined>;
}

/** A local provider can implement both contracts, but callers depend on each interface separately. */
export interface CatalogAvailabilityProvider extends ProductCatalogProvider, AvailabilityProvider, ProductSearchProvider {}

export interface WishlistProvider {
  list(): readonly WishlistItem[] | Promise<readonly WishlistItem[]>;
}

export interface NotificationProvider {
  notify(message: string): Promise<void> | void;
}

