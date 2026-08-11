import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DecisionReason, type Decision } from "../models.js";
/** SQLite audit storage for non-sensitive local eligibility decisions. */
export class DecisionRepository {
  public constructor(private readonly databasePath: string) {}

  public initialize(): void {
    mkdirSync(dirname(this.databasePath), { recursive: true });
    using database = new DatabaseSync(this.databasePath);
    database.exec(`CREATE TABLE IF NOT EXISTS decisions (
      id INTEGER PRIMARY KEY,
      approved INTEGER NOT NULL,
      reason TEXT NOT NULL,
      wishlist_item_id TEXT NOT NULL,
      product_identifier TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price_paise INTEGER,
      order_value_paise INTEGER,
      item_sku TEXT,
      item_name TEXT,
      decided_at TEXT NOT NULL
    )`);
  }

  public record(decision: Decision): void {
    using database = new DatabaseSync(this.databasePath);
    database.prepare(`INSERT INTO decisions (
      approved, reason, wishlist_item_id, product_identifier, quantity, unit_price_paise,
      order_value_paise, item_sku, item_name, decided_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      Number(decision.approved), decision.reason, decision.wishlistItemId, decision.productIdentifier,
      decision.quantity, decision.unitPricePaise ?? null, decision.orderValuePaise ?? null,
      decision.item?.sku ?? null, decision.item?.name ?? null, decision.decidedAt.toISOString(),
    );
  }

  public approvedSpendingBetween(start: Date, end: Date): number {
    using database = new DatabaseSync(this.databasePath);
    const row = database.prepare(`SELECT COALESCE(SUM(order_value_paise), 0) AS total FROM decisions
      WHERE approved = 1 AND decided_at >= ? AND decided_at <= ?`).get(start.toISOString(), end.toISOString()) as { total: number };
    return row.total;
  }

  public latestApprovedForWishlist(wishlistItemId: string): Date | undefined {
    return this.latestApproved("wishlist_item_id", wishlistItemId);
  }

  public latestApprovedForProduct(productIdentifier: string): Date | undefined {
    return this.latestApproved("product_identifier", productIdentifier);
  }

  public count(): number {
    using database = new DatabaseSync(this.databasePath);
    return (database.prepare("SELECT COUNT(*) AS count FROM decisions").get() as { count: number }).count;
  }

  private latestApproved(column: "wishlist_item_id" | "product_identifier", value: string): Date | undefined {
    using database = new DatabaseSync(this.databasePath);
    const row = database.prepare(`SELECT decided_at FROM decisions
      WHERE approved = 1 AND ${column} = ? ORDER BY decided_at DESC LIMIT 1`).get(value) as { decided_at?: string } | undefined;
    return row?.decided_at === undefined ? undefined : new Date(row.decided_at);
  }
}
