import type { CatalogItem, DeliveryLocation } from "../models.js";
import type { CatalogAvailabilityProvider, ProductAvailability } from "./providers.js";

export class AuthorizedDataAggregatorProvider implements CatalogAvailabilityProvider {
  constructor(private readonly apiEndpoint: string, private readonly apiKey: string, private readonly timeoutMs: number = 5000) {}

  public async searchProducts(query: string, location?: DeliveryLocation): Promise<readonly CatalogItem[]> {
    if (!location?.latitude || !location?.longitude) {
      throw new Error("Latitude and longitude are required for authorized API search");
    }

    const url = new URL(`${this.apiEndpoint}/search`);
    url.searchParams.set("q", query);
    url.searchParams.set("platform", "BlinkIt");
    url.searchParams.set("lat", location.latitude.toString());
    url.searchParams.set("lon", location.longitude.toString());

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        headers: { "X-API-Key": this.apiKey },
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error: any) {
      throw new Error(`Authorized API network error: ${error.message}`);
    }

    if (!response.ok) {
      throw new Error(`Authorized API error: ${response.status}`);
    }

    let data;
    try {
      data = await response.json();
    } catch (err) {
      throw new Error("Authorized API returned malformed JSON");
    }

    const items: CatalogItem[] = [];
    if (data && data.data && Array.isArray(data.data.products)) {
      for (const item of data.data.products) {
        if (!item.id || !item.name || typeof item.offer_price !== "number" || item.offer_price < 0) continue;
        items.push({
          sku: String(item.id),
          name: String(item.name),
          pricePaise: Math.round(item.offer_price * 100),
          available: Boolean(item.available),
          availableQuantity: typeof item.inventory === "number" && item.inventory >= 0 ? item.inventory : (item.available ? 1 : 0)
        });
      }
    }
    return items;
  }

  public async getAvailability(productIdentifier: string, location?: DeliveryLocation): Promise<ProductAvailability | undefined> {
    if (!location?.latitude || !location?.longitude) {
      throw new Error("Latitude and longitude are required for authorized API availability check");
    }

    const url = new URL(`${this.apiEndpoint}/item`);
    url.searchParams.set("item_id", productIdentifier);
    url.searchParams.set("platform", "BlinkIt");
    url.searchParams.set("lat", location.latitude.toString());
    url.searchParams.set("lon", location.longitude.toString());

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        headers: { "X-API-Key": this.apiKey },
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error: any) {
      // Return undefined on network/timeout errors to avoid crashing, but log it?
      // Wait, the prompt says "Fail safely on: timeouts. Do not assume availability when the provider fails."
      // In app.ts and monitor.ts, throwing an error is handled gracefully.
      throw new Error(`Availability network error: ${error.message}`);
    }

    if (!response.ok) {
      if (response.status === 404) return undefined; // Product legitimately not found
      throw new Error(`Availability API error: ${response.status}`);
    }

    let data;
    try {
      data = await response.json();
    } catch (err) {
      throw new Error("Availability API returned malformed JSON");
    }

    if (!data || !data.data || !Array.isArray(data.data.items) || data.data.items.length === 0) {
      throw new Error("Availability API returned missing required fields");
    }

    const item = data.data.items[0];

    if (typeof item.price !== "number" || item.price < 0 || typeof item.available !== "boolean") {
      throw new Error("Availability API returned missing required fields");
    }

    const available = item.available;
    return {
      productIdentifier,
      available,
      availableQuantity: typeof item.inventory === "number" && item.inventory >= 0 ? item.inventory : (available ? 1 : 0),
      pricePaise: Math.round(item.price * 100)
    };
  }
  
  public lookupProducts(query: string): readonly CatalogItem[] {
    throw new Error("Authorized API does not support generic catalog lookup without location.");
  }
}
