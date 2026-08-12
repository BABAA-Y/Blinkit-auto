import { DatabaseSync } from "node:sqlite";

export class SettingsRepository {
  public constructor(private readonly databasePath: string) {}

  public initialize(): void {
    using database = new DatabaseSync(this.databasePath);
    database.exec(`CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )`);
  }

  public get(key: string): string | undefined {
    using database = new DatabaseSync(this.databasePath);
    const row = database.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as any;
    return row?.value || undefined;
  }

  public set(key: string, value: string): void {
    using database = new DatabaseSync(this.databasePath);
    database.prepare(`
      INSERT INTO app_settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
  }
}
