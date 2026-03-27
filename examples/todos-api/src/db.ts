import { Database } from 'bun:sqlite';

export let db: Database;

export function initDb(path: string = process.env.DB_PATH || 'todos.db'): void {
  db = new Database(path);
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      username      TEXT UNIQUE NOT NULL,
      email         TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      roles         TEXT DEFAULT 'user',
      created_at    TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS categories (
      id         TEXT PRIMARY KEY,
      name       TEXT UNIQUE NOT NULL,
      color      TEXT DEFAULT '#6366f1',
      user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS todos (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      description TEXT,
      completed   INTEGER DEFAULT 0,
      user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
      category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now'))
    )
  `);
}
