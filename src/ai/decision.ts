import type { CatalogItem, WishlistItem } from "../models.js";

export interface ItemSelector {
  select(wishlistItem: WishlistItem, candidates: readonly CatalogItem[]): CatalogItem | undefined;
}

export function buildSearchQuery(item: WishlistItem): string {
  if (!item.keywords || item.keywords.length === 0) {
    return item.desiredProductName;
  }
  
  // Prefer multi-word keywords that are likely model names over generic single words
  const multiWord = item.keywords.filter(k => k.trim().includes(" "));
  if (multiWord.length > 0) {
    return multiWord[0]!;
  }
  
  return item.keywords[0]!;
}

/** Local, deterministic selection; it makes no external AI calls. */
export class LocalProductMatcher implements ItemSelector {
  public select(wishlistItem: WishlistItem, candidates: readonly CatalogItem[]): CatalogItem | undefined {
    let bestScore = -1;
    let bestMatch: CatalogItem | undefined = undefined;

    for (const item of candidates) {
      const score = this.calculateScore(wishlistItem, item);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = item;
      }
    }
    return bestScore > 0 ? bestMatch : undefined;
  }

  private calculateScore(wishlist: WishlistItem, item: CatalogItem): number {
    let score = 0;
    const itemName = item.name.toLowerCase();
    const desiredName = wishlist.desiredProductName.toLowerCase();
    
    // exact name
    if (itemName === desiredName) score += 100;
    // normalized name (includes)
    else if (itemName.includes(desiredName) || desiredName.includes(itemName)) score += 50;
    
    // keywords
    if (wishlist.keywords) {
       const matchedKeywords = wishlist.keywords.filter(k => itemName.includes(k.toLowerCase())).length;
       score += matchedKeywords * 10;
    }
    
    // brand
    if (wishlist.brand && itemName.includes(wishlist.brand.toLowerCase())) {
       score += 20;
    }

    // prefer available items strongly
    if (item.available && item.availableQuantity >= wishlist.quantity) {
       score += 200;
    }
    
    return score;
  }
}
