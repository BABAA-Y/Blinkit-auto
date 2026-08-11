import { DatabaseSync } from "node:sqlite";
import type { DeliveryLocation } from "../models.js";

export class LocationRepository {
  public constructor(private readonly databasePath: string) {}

  public initialize(): void {
    using database = new DatabaseSync(this.databasePath);
    database.exec(`CREATE TABLE IF NOT EXISTS delivery_location (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      pincode TEXT NOT NULL,
      city TEXT,
      state TEXT,
      latitude REAL,
      longitude REAL
    )`);
  }

  public get(): DeliveryLocation | undefined {
    using database = new DatabaseSync(this.databasePath);
    const row = database.prepare("SELECT pincode, city, state, latitude, longitude FROM delivery_location WHERE id = 1").get() as any;
    if (!row) return undefined;
    return {
      pincode: row.pincode,
      city: row.city || undefined,
      state: row.state || undefined,
      latitude: row.latitude === null ? undefined : row.latitude,
      longitude: row.longitude === null ? undefined : row.longitude,
    };
  }

  public set(location: DeliveryLocation): void {
    using database = new DatabaseSync(this.databasePath);
    database.prepare(`
      INSERT INTO delivery_location (id, pincode, city, state, latitude, longitude)
      VALUES (1, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
      pincode = excluded.pincode,
      city = excluded.city,
      state = excluded.state,
      latitude = excluded.latitude,
      longitude = excluded.longitude
    `).run(
      location.pincode,
      location.city ?? null,
      location.state ?? null,
      location.latitude ?? null,
      location.longitude ?? null
    );
  }
}
