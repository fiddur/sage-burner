import { drizzle } from 'drizzle-orm/node-sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import * as schema from './schema.ts'

export interface DbHandle {
  db: ReturnType<typeof drizzle<typeof schema>>
  client: DatabaseSync
  close: () => void
}

export interface CreateDbOptions {
  url: string
}

const IN_MEMORY = ':memory:'

export const createDb = ({ url }: CreateDbOptions): DbHandle => {
  if (url.trim() === '') {
    throw new Error(
      'Database url is empty. SQLite would silently open a throwaway in-memory database and lose ' +
        'everything on shutdown — set DATABASE_URL, or pass ":memory:" if that is genuinely wanted.',
    )
  }

  if (url !== IN_MEMORY) mkdirSync(path.dirname(url), { recursive: true, mode: 0o700 })

  const client = new DatabaseSync(url)

  client.exec('PRAGMA foreign_keys = ON')

  client.exec('PRAGMA busy_timeout = 5000')

  if (url !== IN_MEMORY) {
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

export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
