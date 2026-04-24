import { Database } from 'bun:sqlite'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { VISSOR_HOME } from './paths.js'

const DB_PATH = join(VISSOR_HOME, 'vissor.db')

let dbInstance: Database | null = null

export async function getDb(): Promise<Database> {
  if (dbInstance) return dbInstance
  await mkdir(dirname(DB_PATH), { recursive: true })
  const db = new Database(DB_PATH)
  // WAL keeps reads unblocked while a session or migration writes.
  db.run('PRAGMA journal_mode = WAL;')
  db.run('PRAGMA foreign_keys = ON;')
  runMigrations(db)
  dbInstance = db
  return db
}

/**
 * Simple forward-only migration ledger. Tracks applied versions in
 * `schema_version` so we can evolve the schema without re-running DDL.
 */
function runMigrations(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `)
  const current = db
    .query<{ version: number }, []>(
      'SELECT COALESCE(MAX(version), 0) AS version FROM schema_version',
    )
    .get()
  const at = current?.version ?? 0
  const migrations: { v: number; sql: string }[] = [
    {
      v: 1,
      sql: `
        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE sessions (
          token TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );
        CREATE INDEX sessions_user ON sessions(user_id);
      `,
    },
  ]
  for (const m of migrations) {
    if (m.v <= at) continue
    db.transaction(() => {
      db.run(m.sql)
      db.run('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)', [
        m.v,
        Date.now(),
      ])
    })()
  }
}
