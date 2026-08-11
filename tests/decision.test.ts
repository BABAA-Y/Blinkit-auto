import { describe, expect, it } from "vitest";
import { buildSearchQuery, LocalProductMatcher } from "../src/ai/decision.js";
import type { WishlistItem, CatalogItem } from "../src/models.js";

describe("decision logic", () => {
  describe("buildSearchQuery", () => {
    it("returns desiredProductName when no keywords exist", () => {
      const item: WishlistItem = {
        id: "1", desiredProductName: "Generic Milk", quantity: 1, maximumUnitPricePaise: 1000, enabled: true, cooldownMinutes: 0
      };
      expect(buildSearchQuery(item)).toBe("Generic Milk");
    });

    it("prefers multi-word keywords over single words", () => {
      const item: WishlistItem = {
        id: "1", desiredProductName: "Hot Wheels Tooned Volkswagen Golf Die Cast Car", 
        keywords: ["Tooned", "Volkswagen Golf", "Golf", "Die Cast Car"],
        quantity: 1, maximumUnitPricePaise: 1000, enabled: true, cooldownMinutes: 0
      };
      // "Volkswagen Golf" is the first multi-word keyword
      expect(buildSearchQuery(item)).toBe("Volkswagen Golf");
    });
    
    it("falls back to first keyword if no multi-word keywords exist", () => {
      const item: WishlistItem = {
        id: "1", desiredProductName: "Apple", 
        keywords: ["Fruit", "Red"],
        quantity: 1, maximumUnitPricePaise: 1000, enabled: true, cooldownMinutes: 0
      };
      expect(buildSearchQuery(item)).toBe("Fruit");
    });
  });

  describe("LocalProductMatcher", () => {
    it("matches Hot Wheels Volkswagen Golf", () => {
      const matcher = new LocalProductMatcher();
      const wishlist: WishlistItem = {
        id: "1", desiredProductName: "Hot Wheels Tooned Volkswagen Golf Die Cast Car", 
        brand: "Hot Wheels",
        keywords: ["Tooned", "Volkswagen Golf", "Golf", "Die Cast Car"],
        quantity: 1, maximumUnitPricePaise: 1000, enabled: true, cooldownMinutes: 0
      };

      const candidates: CatalogItem[] = [
        { sku: "1", name: "Random Toy Car", pricePaise: 100, available: true, availableQuantity: 10 },
        { sku: "2", name: "Volkswagen Golf Die Cast Car - Hot Wheels", pricePaise: 15000, available: true, availableQuantity: 2 },
      ];

      const selected = matcher.select(wishlist, candidates);
      expect(selected).toBeDefined();
      expect(selected?.sku).toBe("2");
    });
  });
});
