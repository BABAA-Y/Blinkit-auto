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
