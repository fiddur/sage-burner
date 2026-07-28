import { drizzle } from 'drizzle-orm/node-sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import * as schema from './schema.ts'

/**
 * The database handle, created per application rather than imported as a
 * singleton, so tests can stand up an isolated in-memory database and the
 * lifetime is owned by whoever created it.
 *
 * Uses Node's built-in `node:sqlite` rather than a native binding: nothing to
 * compile means no build toolchain in the runtime image and no coupling to a
 * specific Node ABI.
 */
export interface DbHandle {
  db: ReturnType<typeof drizzle<typeof schema>>
  /** Escape hatch for pragmas and migrations. Prefer `db` for anything else. */
  client: DatabaseSync
  close: () => void
}

export interface CreateDbOptions {
  /** Path to the SQLite file, or `:memory:` for an ephemeral database. */
  url: string
}

const IN_MEMORY = ':memory:'

export const createDb = ({ url }: CreateDbOptions): DbHandle => {
  // SQLite will not create a missing parent directory — it just fails with
  // `unable to open database file`. The default lives under a gitignored
  // `data/`, so on a fresh checkout, and on a fresh Docker volume, that
  // directory does not exist yet.
  if (url !== IN_MEMORY) mkdirSync(path.dirname(url), { recursive: true })

  const client = new DatabaseSync(url)

  // SQLite ships with foreign key enforcement OFF, per connection. Without
  // this every `references()` in the schema is decorative and orphaned rows
  // are accepted silently.
  client.exec('PRAGMA foreign_keys = ON')

  // Wait rather than failing outright when another connection holds a write
  // lock. Relevant even single-process, since WAL checkpoints can block.
  client.exec('PRAGMA busy_timeout = 5000')

  if (url !== IN_MEMORY) {
    // WAL lets readers proceed during a write, which matters when an admin is
    // editing while members are loading the schedule. NORMAL trades an fsync
    // per commit for a small durability window on power loss — acceptable for
    // this data, and the difference is very noticeable on cheap disks.
    client.exec('PRAGMA journal_mode = WAL')
    client.exec('PRAGMA synchronous = NORMAL')
  }

  return {
    db: drizzle({ client, schema }),
    client,
    close: () => client.close(),
  }
}

export type Database = DbHandle['db']
