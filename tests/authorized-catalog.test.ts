import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { AuthorizedDataAggregatorProvider } from "../src/integrations/authorized-catalog.js";

describe("AuthorizedDataAggregatorProvider", () => {
  const endpoint = "https://api.quickcommerceapi.com/v1";
  const apiKey = "test-key";
  const provider = new AuthorizedDataAggregatorProvider(endpoint, apiKey, 5000);
  const location = { pincode: "110001", latitude: 28.6139, longitude: 77.2090 };

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("searchProducts", () => {
    it("returns successful search candidates", async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          data: {
            products: [
              { id: "123", name: "Milk", offer_price: 68.00, available: true, inventory: 5 }
            ]
          }
        })
      };
      (global.fetch as any).mockResolvedValue(mockResponse);

      const results = await provider.searchProducts("Milk", location);
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({ sku: "123", name: "Milk", pricePaise: 6800, available: true, availableQuantity: 5 });
    });

    it("fails when missing coordinates", async () => {
      await expect(provider.searchProducts("Milk", { pincode: "110001" })).rejects.toThrow("Latitude and longitude are required");
    });
  });

  describe("getAvailability", () => {
    it("returns successful item lookup", async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          data: {
            items: [
              { price: 68.00, available: true, inventory: 5 }
            ]
          }
        })
      };
      (global.fetch as any).mockResolvedValue(mockResponse);

      const result = await provider.getAvailability("123", location);
      expect(result).toEqual({ productIdentifier: "123", available: true, availableQuantity: 5, pricePaise: 6800 });
    });

    it("returns unavailable for unavailable item", async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          data: {
            items: [
              { price: 68.00, available: false, inventory: 0 }
            ]
          }
        })
      };
      (global.fetch as any).mockResolvedValue(mockResponse);

      const result = await provider.getAvailability("123", location);
      expect(result).toEqual({ productIdentifier: "123", available: false, availableQuantity: 0, pricePaise: 6800 });
    });

    it("safely handles 404 by returning undefined", async () => {
      const mockResponse = { ok: false, status: 404 };
      (global.fetch as any).mockResolvedValue(mockResponse);

      const result = await provider.getAvailability("123", location);
      expect(result).toBeUndefined();
    });

    it("fails safely on 401 Unauthorized", async () => {
      const mockResponse = { ok: false, status: 401 };
      (global.fetch as any).mockResolvedValue(mockResponse);

      await expect(provider.getAvailability("123", location)).rejects.toThrow("Availability API error: 401");
    });

    it("fails safely on 429 Rate Limit", async () => {
      const mockResponse = { ok: false, status: 429 };
      (global.fetch as any).mockResolvedValue(mockResponse);

      await expect(provider.getAvailability("123", location)).rejects.toThrow("Availability API error: 429");
    });

    it("fails safely on timeout / network error", async () => {
      (global.fetch as any).mockRejectedValue(new Error("Timeout"));

      await expect(provider.getAvailability("123", location)).rejects.toThrow("Availability network error: Timeout");
    });

    it("fails safely on malformed JSON", async () => {
      const mockResponse = { ok: true, json: async () => { throw new Error("SyntaxError"); } };
      (global.fetch as any).mockResolvedValue(mockResponse);

      await expect(provider.getAvailability("123", location)).rejects.toThrow("Availability API returned malformed JSON");
    });

    it("fails safely on missing required fields", async () => {
      const mockResponse = { ok: true, json: async () => ({ data: { items: [{ available: true }] } }) }; // Missing price
      (global.fetch as any).mockResolvedValue(mockResponse);

      await expect(provider.getAvailability("123", location)).rejects.toThrow("Availability API returned missing required fields");
    });
    
    it("fails safely on empty items array", async () => {
      const mockResponse = { ok: true, json: async () => ({ data: { items: [] } }) };
      (global.fetch as any).mockResolvedValue(mockResponse);

      await expect(provider.getAvailability("123", location)).rejects.toThrow("Availability API returned missing required fields");
    });
  });
});
