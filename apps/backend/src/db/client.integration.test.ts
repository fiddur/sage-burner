import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { DbHandle } from './client.ts'

import { createDb } from './client.ts'
import { runMigrations } from './migrate.ts'
import { event } from './schema.ts'

/**
 * Covers the file-backed branch of `createDb`.
 *
 * Every other test uses `:memory:`, which skips both the directory creation and
 * the WAL pragmas — i.e. exactly the half that runs in production, where a
 * regression would only surface against a fresh Docker volume.
 *
 * Note: the relative-path cases call `process.chdir`, which works under
 * vitest's default `forks` pool but throws under `threads`. If a
 * `vitest.config.ts` ever sets a pool, keep this file on `forks`.
 */

let dir: string
let handle: DbHandle | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sage-burner-db-'))
  handle = undefined
})

afterEach(() => {
  handle?.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('createDb url validation', () => {
  it('refuses an empty url rather than opening a throwaway database', () => {
    // `new DatabaseSync('')` succeeds and opens a private temporary database,
    // so without this guard everything appears to work and the data is gone at
    // shutdown. The cheapest possible test for the most expensive regression:
    // a refactor dropping the guard, or reverting migrate-cli to `??`, would
    // otherwise reintroduce silent data loss with a fully green suite.
    expect(() => createDb({ url: '' })).toThrow(/empty/i)
    expect(() => createDb({ url: '   ' })).toThrow(/empty/i)
  })

  it('still accepts an explicit :memory:', () => {
    const memory = createDb({ url: ':memory:' })
    expect(() => memory.close()).not.toThrow()
  })
})

describe('createDb against a file', () => {
  it('creates missing parent directories', () => {
    // SQLite will not create them and fails with `unable to open database
    // file`. The default path lives under a gitignored `data/`, so this is the
    // normal case on a fresh checkout and on a fresh volume — not an edge case.
    const file = join(dir, 'nested', 'deeper', 'sage-burner.sqlite')
    expect(existsSync(file)).toBe(false)

    handle = createDb({ url: file })

    expect(existsSync(file)).toBe(true)
  })

  it('opens in WAL mode so readers are not blocked by a writer', () => {
    handle = createDb({ url: join(dir, 'sage-burner.sqlite') })

    const mode = handle.client.prepare('PRAGMA journal_mode').get()
    expect(mode?.journal_mode).toBe('wal')
  })

  it('enforces foreign keys on a file-backed database too', () => {
    handle = createDb({ url: join(dir, 'sage-burner.sqlite') })

    expect(handle.client.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1)
  })

  it('handles a relative url, which is what the default DATABASE_URL is', () => {
    // `./data/sage-burner.sqlite` is the default, so relative paths are the
    // normal case rather than an edge one. Needs the process cwd moved, since
    // that is what "relative" resolves against — restored immediately so a
    // stray database cannot land in the repo.
    const cwd = process.cwd()
    try {
      process.chdir(dir)
      handle = createDb({ url: './data/sage-burner.sqlite' })
      expect(existsSync(join(dir, 'data', 'sage-burner.sqlite'))).toBe(true)
    } finally {
      process.chdir(cwd)
    }
  })

  it('handles a bare filename, whose dirname is "."', () => {
    const cwd = process.cwd()
    try {
      process.chdir(dir)
      handle = createDb({ url: 'bare.sqlite' })
      expect(existsSync(join(dir, 'bare.sqlite'))).toBe(true)
    } finally {
      process.chdir(cwd)
    }
  })

  it('persists data across connections, which is the whole point of the volume', () => {
    const file = join(dir, 'sage-burner.sqlite')

    const first = createDb({ url: file })
    runMigrations(first)
    first.db
      .insert(event)
      .values({
        id: 'e0000000-0000-4000-8000-000000000001',
        name: 'The Burning Sage @ Hökås',
        slug: 'burning-sage-autumn-2026',
        start_date: '2026-10-02',
        end_date: '2026-10-04',
        welcome_markdown: '',
        payment_info_markdown: '',
        member_cap: 42,
        created_at: '2026-07-28T10:00:00Z',
      })
      .run()
    first.close()

    handle = createDb({ url: file })
    expect(handle.db.select().from(event).all()).toHaveLength(1)
  })
})
