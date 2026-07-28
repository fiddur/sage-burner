import { migrate } from 'drizzle-orm/node-sqlite/migrator'
import path from 'node:path'

import type { DbHandle } from './client.ts'

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
 * Foreign keys are disabled for the duration, then the result is checked before
 * they go back on. That is not paranoia about our own SQL — it is forced by how
 * SQLite alters tables. SQLite cannot change a column in place, so drizzle-kit
 * emits a rebuild: `CREATE __new_x`, copy, `DROP TABLE x`, rename. With foreign
 * keys on, that `DROP` cascade-deletes the children of a parent table — rebuild
 * `event` and its members, applications and sessions go with it, silently and
 * inside a transaction that commits successfully.
 *
 * `PRAGMA foreign_keys` is a no-op inside a transaction and drizzle wraps
 * migrations in one, so out here is the only place it can be toggled at all.
 * `foreign_key_check` afterwards turns what would be a silent data loss into a
 * failed boot, which is the difference between noticing on deploy and noticing
 * when an organiser opens an empty member list.
 */
export const runMigrations = (handle: DbHandle, folder: string = migrationsFolder): void => {
  const { db, client } = handle

  client.exec('PRAGMA foreign_keys = OFF')
  try {
    migrate(db, { migrationsFolder: folder })

    const violations = client.prepare('PRAGMA foreign_key_check').all()
    if (violations.length > 0) {
      throw new Error(
        `Migration left ${violations.length} foreign key violation(s); refusing to continue. ` +
          `First: ${JSON.stringify(violations[0])}`,
      )
    }
  } finally {
    client.exec('PRAGMA foreign_keys = ON')
  }
}
