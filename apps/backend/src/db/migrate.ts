import { migrate } from 'drizzle-orm/node-sqlite/migrator'
import path from 'node:path'

import type { DbHandle } from './client.ts'

export const migrationsFolder = path.join(import.meta.dirname, '..', '..', 'drizzle')

export const runMigrations = (handle: DbHandle, folder: string = migrationsFolder): void => {
  const { db, client } = handle

  // Load-bearing, not paranoia: SQLite cannot alter a column in place, so drizzle emits a
  // table rebuild whose `DROP` cascade-deletes children. The `foreign_key_check` below does
  // not catch that — a cascade leaves nothing dangling — so this is the only protection.
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
