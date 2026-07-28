import { migrate } from 'drizzle-orm/node-sqlite/migrator'
import path from 'node:path'

import type { Database } from './client.ts'

/**
 * Where `drizzle-kit generate` writes its SQL. Resolved relative to this file
 * so it works the same from a checkout and from the container, neither of
 * which shares a working directory.
 */
export const migrationsFolder = path.join(import.meta.dirname, '..', '..', 'drizzle')

/**
 * Apply any migrations the database has not seen yet.
 *
 * Called at startup: a fresh volume gets the whole schema, an existing one gets
 * only what's new. Drizzle tracks what has run in its own table, so this is
 * idempotent and safe to call on every boot.
 *
 * Trap to check the first time a generated migration alters a column: SQLite
 * cannot alter in place, so drizzle-kit emits a table rebuild — `CREATE
 * __new_x`, copy, `DROP TABLE x`, rename. With `PRAGMA foreign_keys = ON`, the
 * `DROP` cascade-deletes children of a parent table like `event`. The pragma is
 * a no-op inside a transaction, so it cannot simply be toggled off mid-
 * migration either. Only `CREATE TABLE` statements exist today; read the
 * generated SQL before trusting the first one that rebuilds.
 */
export const runMigrations = (db: Database, folder: string = migrationsFolder): void => {
  migrate(db, { migrationsFolder: folder })
}
