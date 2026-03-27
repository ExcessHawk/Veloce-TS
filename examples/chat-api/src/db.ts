import { Database } from 'bun:sqlite';

export let db: Database;

export function initDb(path: string = process.env.DB_PATH || 'chat.db'): void {
  db = new Database(path);
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      username      TEXT UNIQUE NOT NULL,
      email         TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS rooms (
      id          TEXT PRIMARY KEY,
      name        TEXT UNIQUE NOT NULL,
      description TEXT,
      owner_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at  TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id         TEXT PRIMARY KEY,
      content    TEXT NOT NULL,
      user_id    TEXT REFERENCES users(id) ON DELETE CASCADE,
      room_id    TEXT REFERENCES rooms(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}
