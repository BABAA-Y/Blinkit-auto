import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE linking_sessions (
  code TEXT PRIMARY KEY,
  user_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
)`);

const code = "XYZ123";
const now = Date.now();
const expires = new Date(now + 10 * 60 * 1000).toISOString();
db.prepare(`INSERT INTO linking_sessions (code, created_at, expires_at) VALUES (?, ?, ?)`).run(code, new Date(now).toISOString(), expires);

const deleteNow = new Date().toISOString();
db.prepare(`DELETE FROM linking_sessions WHERE expires_at < ?`).run(deleteNow);

const result = db.prepare(`UPDATE linking_sessions SET user_id = ? WHERE code = ? AND user_id IS NULL`).run("user-1", code);

console.log("Changes:", result.changes);
