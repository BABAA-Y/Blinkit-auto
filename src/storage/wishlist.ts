import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { WishlistItem } from "../models.js";

/** SQLite-backed local wishlist storage. It contains no account or payment credentials. */
export class WishlistRepository {
  public constructor(private readonly databasePath: string) {}

  public initialize(): void {
    mkdirSync(dirname(this.databasePath), { recursive: true });
    using database = new DatabaseSync(this.databasePath);
    database.exec(`CREATE TABLE IF NOT EXISTS wishlist_items (
      id TEXT PRIMARY KEY,
      product_identifier TEXT NOT NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK(quantity > 0),
      maximum_unit_price_paise INTEGER NOT NULL CHECK(maximum_unit_price_paise >= 0),
      enabled INTEGER NOT NULL,
      cooldown_minutes INTEGER NOT NULL CHECK(cooldown_minutes >= 0)
    )`);
  }

  public save(item: WishlistItem): void {
    validateWishlistItem(item);
    using database = new DatabaseSync(this.databasePath);
    database.prepare(`INSERT INTO wishlist_items (
      id, product_identifier, product_name, quantity, maximum_unit_price_paise, enabled, cooldown_minutes
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      product_identifier = excluded.product_identifier,
      product_name = excluded.product_name,
      quantity = excluded.quantity,
      maximum_unit_price_paise = excluded.maximum_unit_price_paise,
      enabled = excluded.enabled,
      cooldown_minutes = excluded.cooldown_minutes`).run(
      item.id, item.productIdentifier, item.productName, item.quantity,
      item.maximumUnitPricePaise, Number(item.enabled), item.cooldownMinutes,
    );
  }

  public list(): WishlistItem[] {
    using database = new DatabaseSync(this.databasePath);
    const rows = database.prepare(`SELECT id, product_identifier, product_name, quantity,
      maximum_unit_price_paise, enabled, cooldown_minutes FROM wishlist_items ORDER BY id`).all() as unknown as WishlistRow[];
    return rows.map((row) => ({
      id: row.id, productIdentifier: row.product_identifier, productName: row.product_name,
      quantity: row.quantity, maximumUnitPricePaise: row.maximum_unit_price_paise,
      enabled: row.enabled === 1, cooldownMinutes: row.cooldown_minutes,
    }));
  }

  public count(): number {
    using database = new DatabaseSync(this.databasePath);
    return (database.prepare("SELECT COUNT(*) AS count FROM wishlist_items").get() as { count: number }).count;
  }

  public remove(id: string): boolean {
    using database = new DatabaseSync(this.databasePath);
    const result = database.prepare("DELETE FROM wishlist_items WHERE id = ?").run(id);
    return result.changes > 0;
  }

  public setEnabled(id: string, enabled: boolean): boolean {
    using database = new DatabaseSync(this.databasePath);
    const result = database.prepare("UPDATE wishlist_items SET enabled = ? WHERE id = ?").run(Number(enabled), id);
    return result.changes > 0;
  }
}

interface WishlistRow {
  id: string;
  product_identifier: string;
  product_name: string;
  quantity: number;
  maximum_unit_price_paise: number;
  enabled: number;
  cooldown_minutes: number;
}

function validateWishlistItem(item: WishlistItem): void {
  if (item.id.trim() === "" || item.productIdentifier.trim() === "" || item.productName.trim() === "") {
    throw new Error("Wishlist item id, product identifier, and product name are required");
  }
  if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) throw new Error("Wishlist quantity must be a positive integer");
  if (!Number.isSafeInteger(item.maximumUnitPricePaise) || item.maximumUnitPricePaise < 0) {
    throw new Error("Wishlist maximum unit price must be a non-negative integer in paise");
  }
  if (!Number.isSafeInteger(item.cooldownMinutes) || item.cooldownMinutes < 0) {
    throw new Error("Wishlist cooldown must be a non-negative integer in minutes");
  }
}
