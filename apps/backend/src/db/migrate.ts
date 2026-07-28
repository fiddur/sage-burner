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
 */
export const runMigrations = (db: Database, folder: string = migrationsFolder): void => {
  migrate(db, { migrationsFolder: folder })
}
