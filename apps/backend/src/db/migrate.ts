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
 * Foreign keys are disabled for the duration. That is not paranoia about our own
 * SQL — it is forced by how SQLite alters tables. SQLite cannot change a column
 * in place, so drizzle-kit emits a rebuild: `CREATE __new_x`, copy,
 * `DROP TABLE x`, rename. With foreign keys on, that `DROP` cascade-deletes the
 * children of a parent table — rebuild `event` and its members, applications
 * and sessions go with it, silently, inside a transaction that then commits
 * successfully.
 *
 * **Turning them off is the whole protection.** The `foreign_key_check`
 * afterwards does not catch that case and must not be mistaken for a net under
 * it: a cascade leaves nothing dangling, so the check comes back empty while
 * the rows are gone. What it does catch is the inverse — children left pointing
 * at a parent that vanished, which is what the same rebuild produces once
 * cascades are off. Both are worth having; only one of them is this function's
 * reason for existing.
 *
 * Hence the read-back. `PRAGMA foreign_keys` is a no-op inside a transaction
 * and drizzle wraps migrations in one, so out here is the only place it can be
 * toggled at all — and a silently ineffective `OFF` would arm the very cascade
 * this exists to prevent. Better to refuse to migrate than to find out
 * afterwards.
 *
 * If that check ever does fire, the database will not heal itself: drizzle has
 * already committed and recorded the migration, so it will not re-run and every
 * subsequent boot fails the same way. That is deliberate — better a container
 * that refuses to start than one serving a half-deleted event — but recovery is
 * manual, and restoring the volume from backup is usually the fastest route.
 */
export const runMigrations = (handle: DbHandle, folder: string = migrationsFolder): void => {
  const { db, client } = handle

  client.exec('PRAGMA foreign_keys = OFF')
  try {
    if (client.prepare('PRAGMA foreign_keys').get()?.foreign_keys !== 0) {
      throw new Error(
        'Could not disable foreign keys before migrating (already inside a transaction?) — ' +
          'refusing to run a table rebuild with cascades armed.',
      )
    }

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
