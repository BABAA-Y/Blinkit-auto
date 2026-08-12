import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

export interface UserRecord {
  id: string;
  telegramChatId: string;
  telegramUserId?: string;
  username?: string;
  createdAt: string;
  updatedAt: string;
}

export class UserRepository {
  constructor(private readonly databasePath: string) {}

  public initialize(): void {
    using db = new DatabaseSync(this.databasePath);
    db.exec(`CREATE TABLE IF NOT EXISTS server_users (
      id TEXT PRIMARY KEY,
      telegram_chat_id TEXT UNIQUE NOT NULL,
      telegram_user_id TEXT,
      username TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS linking_sessions (
      code TEXT PRIMARY KEY,
      user_id TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )`);
  }

  public createLinkingSession(): string {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const now = Date.now();
    const expires = new Date(now + 10 * 60 * 1000).toISOString();
    using db = new DatabaseSync(this.databasePath);
    db.prepare(`INSERT INTO linking_sessions (code, created_at, expires_at) VALUES (?, ?, ?)`).run(code, new Date(now).toISOString(), expires);
    return code;
  }

  public completeLinkingSession(code: string, userId: string): boolean {
    using db = new DatabaseSync(this.databasePath);
    const now = new Date().toISOString();
    db.prepare(`DELETE FROM linking_sessions WHERE expires_at < ?`).run(now);
    
    const result = db.prepare(`UPDATE linking_sessions SET user_id = ? WHERE code = ? AND (user_id IS NULL OR user_id = ?)`).run(userId, code, userId);
    return result.changes > 0;
  }

  public getLinkedUserForSession(code: string): string | undefined {
    using db = new DatabaseSync(this.databasePath);
    const row = db.prepare(`SELECT user_id FROM linking_sessions WHERE code = ?`).get(code) as any;
    return row?.user_id || undefined;
  }

  public getUserById(id: string): UserRecord | undefined {
    using db = new DatabaseSync(this.databasePath);
    const row = db.prepare("SELECT * FROM server_users WHERE id = ?").get(id) as any;
    if (!row) return undefined;
    return {
      id: row.id,
      telegramChatId: row.telegram_chat_id,
      telegramUserId: row.telegram_user_id || undefined,
      username: row.username || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  public upsertTelegramUser(chatId: string, userId?: string, username?: string): UserRecord {
    using db = new DatabaseSync(this.databasePath);
    const now = new Date().toISOString();
    
    const existing = db.prepare("SELECT id, created_at FROM server_users WHERE telegram_chat_id = ?").get(chatId) as any;
    
    if (existing) {
      db.prepare(`UPDATE server_users SET 
        telegram_user_id = ?, 
        username = ?, 
        updated_at = ? 
        WHERE id = ?`).run(userId || null, username || null, now, existing.id);
      
      return { id: existing.id, telegramChatId: chatId, telegramUserId: userId, username, createdAt: existing.created_at, updatedAt: now };
    } else {
      const id = randomUUID();
      db.prepare(`INSERT INTO server_users (id, telegram_chat_id, telegram_user_id, username, created_at, updated_at) 
        VALUES (?, ?, ?, ?, ?, ?)`).run(id, chatId, userId || null, username || null, now, now);
      return { id, telegramChatId: chatId, telegramUserId: userId, username, createdAt: now, updatedAt: now };
    }
  }

  public getUserByChatId(chatId: string): UserRecord | undefined {
    using db = new DatabaseSync(this.databasePath);
    const row = db.prepare("SELECT * FROM server_users WHERE telegram_chat_id = ?").get(chatId) as any;
    if (!row) return undefined;
    return {
      id: row.id,
      telegramChatId: row.telegram_chat_id,
      telegramUserId: row.telegram_user_id || undefined,
      username: row.username || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
