import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DecisionReason, OrderStatus, type OrderRecord } from "../models.js";
import type { FinalizedOrderHistory } from "../automation/rules.js";

export interface NewOrderRecord extends Omit<OrderRecord, "id"> { wishlistItemId: string; }
export const PROCESSING_LEASE_MS = 60_000;

/** SQLite store for durable, idempotent local order workflow state. */
export class OrderRepository implements FinalizedOrderHistory {
  public constructor(private readonly databasePath: string) {}

  public initialize(): void {
    mkdirSync(dirname(this.databasePath), { recursive: true });
    using database = this.open();
    database.exec(`CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY, idempotency_key TEXT UNIQUE, wishlist_item_id TEXT,
      product_identifier TEXT NOT NULL, product_name TEXT, quantity INTEGER NOT NULL,
      unit_price_paise INTEGER, total_paise INTEGER, decision INTEGER NOT NULL, reason TEXT NOT NULL,
      timestamp TEXT NOT NULL, status TEXT NOT NULL, payment_reference TEXT, submission_reference TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    this.ensureColumn(database, "idempotency_key", "TEXT");
    this.ensureColumn(database, "wishlist_item_id", "TEXT");
    this.ensureColumn(database, "updated_at", "TEXT");
    database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency_key ON orders(idempotency_key);
      CREATE INDEX IF NOT EXISTS idx_orders_finalized_time ON orders(status, timestamp);
      CREATE INDEX IF NOT EXISTS idx_orders_finalized_product ON orders(product_identifier, status, timestamp);
      CREATE INDEX IF NOT EXISTS idx_orders_finalized_wishlist ON orders(wishlist_item_id, status, timestamp);`);
  }

  /** Atomically claims an idempotency key. Failed or stale processing work can be retried. */
  public claim(order: NewOrderRecord, now: Date): boolean {
    using database = this.open();
    database.exec("BEGIN IMMEDIATE");
    try {
      const existing = database.prepare("SELECT status, updated_at FROM orders WHERE idempotency_key = ?").get(order.idempotencyKey) as { status: OrderStatus; updated_at: string } | undefined;
      const canRetry = existing !== undefined && (existing.status === OrderStatus.PAYMENT_FAILED || existing.status === OrderStatus.SUBMISSION_FAILED || (existing.status === OrderStatus.PROCESSING && new Date(existing.updated_at).getTime() <= now.getTime() - PROCESSING_LEASE_MS));
      if (existing === undefined) {
        this.insert(database, { ...order, status: OrderStatus.PROCESSING, timestamp: now });
      } else if (canRetry) {
        database.prepare(`UPDATE orders SET status = ?, payment_reference = NULL, submission_reference = NULL,
          timestamp = ?, updated_at = ? WHERE idempotency_key = ?`).run(OrderStatus.PROCESSING, now.toISOString(), now.toISOString(), order.idempotencyKey);
      } else {
        database.exec("ROLLBACK");
        return false;
      }
      database.exec("COMMIT");
      return true;
    } catch (error) {
      try { database.exec("ROLLBACK"); } catch { /* transaction was already closed */ }
      throw error;
    }
  }

  public recordRejected(order: NewOrderRecord): OrderRecord { return this.record(order); }

  public complete(idempotencyKey: string, status: OrderStatus, paymentReference?: string, submissionReference?: string): OrderRecord {
    using database = this.open();
    const result = database.prepare(`UPDATE orders SET status = ?, payment_reference = ?, submission_reference = ?, updated_at = ?
      WHERE idempotency_key = ? AND status = ?`).run(status, paymentReference ?? null, submissionReference ?? null, new Date().toISOString(), idempotencyKey, OrderStatus.PROCESSING);
    if (result.changes !== 1) throw new Error(`Unable to finalize order state for idempotency key ${idempotencyKey}`);
    return this.findByIdempotencyKey(idempotencyKey, database);
  }

  public finalizedSpendingBetween(start: Date, end: Date): number {
    using database = this.open();
    const row = database.prepare(`SELECT COALESCE(SUM(total_paise), 0) AS total FROM orders
      WHERE status = ? AND timestamp >= ? AND timestamp <= ?`).get(OrderStatus.SUBMITTED, start.toISOString(), end.toISOString()) as { total: number };
    return row.total;
  }
  public latestFinalizedForWishlist(wishlistItemId: string): Date | undefined { return this.latestFinalized("wishlist_item_id", wishlistItemId); }
  public latestFinalizedForProduct(productIdentifier: string): Date | undefined { return this.latestFinalized("product_identifier", productIdentifier); }

  public list(): OrderRecord[] {
    using database = this.open();
    const rows = database.prepare("SELECT * FROM orders ORDER BY id").all() as unknown as OrderRow[];
    return rows.map((row) => this.toRecord(row));
  }

  private record(order: NewOrderRecord): OrderRecord {
    using database = this.open();
    this.insert(database, order);
    return this.findByIdempotencyKey(order.idempotencyKey, database);
  }
  private insert(database: DatabaseSync, order: NewOrderRecord): void {
    database.prepare(`INSERT INTO orders (idempotency_key, wishlist_item_id, product_identifier, product_name, quantity,
      unit_price_paise, total_paise, decision, reason, timestamp, status, payment_reference, submission_reference, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      order.idempotencyKey, order.wishlistItemId, order.productIdentifier, order.productName ?? null, order.quantity,
      order.unitPricePaise ?? null, order.totalPaise ?? null, Number(order.decision), order.reason, order.timestamp.toISOString(),
      order.status, order.paymentReference ?? null, order.submissionReference ?? null, order.timestamp.toISOString(),
    );
  }
  private findByIdempotencyKey(key: string, database?: DatabaseSync): OrderRecord {
    if (database === undefined) { using owned = this.open(); return this.findByIdempotencyKey(key, owned); }
    const row = database.prepare("SELECT * FROM orders WHERE idempotency_key = ?").get(key) as unknown as OrderRow | undefined;
    if (row === undefined) throw new Error(`Order record not found for idempotency key ${key}`);
    return this.toRecord(row);
  }
  private latestFinalized(column: "wishlist_item_id" | "product_identifier", value: string): Date | undefined {
    using database = this.open();
    const row = database.prepare(`SELECT timestamp FROM orders WHERE ${column} = ? AND status = ? ORDER BY timestamp DESC LIMIT 1`).get(value, OrderStatus.SUBMITTED) as { timestamp?: string } | undefined;
    return row?.timestamp === undefined ? undefined : new Date(row.timestamp);
  }
  private toRecord(row: OrderRow): OrderRecord {
    return { id: row.id, idempotencyKey: row.idempotency_key, productIdentifier: row.product_identifier, productName: row.product_name ?? undefined,
      quantity: row.quantity, unitPricePaise: row.unit_price_paise ?? undefined, totalPaise: row.total_paise ?? undefined,
      decision: row.decision === 1, reason: row.reason as DecisionReason, timestamp: new Date(row.timestamp), status: row.status as OrderStatus,
      paymentReference: row.payment_reference ?? undefined, submissionReference: row.submission_reference ?? undefined };
  }
  private ensureColumn(database: DatabaseSync, column: string, definition: string): void {
    const columns = database.prepare("PRAGMA table_info(orders)").all() as unknown as Array<{ name: string }>;
    if (!columns.some((entry) => entry.name === column)) database.exec(`ALTER TABLE orders ADD COLUMN ${column} ${definition}`);
  }
  private open(): DatabaseSync {
    const database = new DatabaseSync(this.databasePath);
    database.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;");
    return database;
  }
}

interface OrderRow { id: number; idempotency_key: string; wishlist_item_id: string | null; product_identifier: string; product_name: string | null; quantity: number; unit_price_paise: number | null; total_paise: number | null; decision: number; reason: string; timestamp: string; status: string; payment_reference: string | null; submission_reference: string | null; updated_at: string; }
