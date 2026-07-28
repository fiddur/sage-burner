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

  it('handles a bare filename with no directory component', () => {
    // `path.dirname('sage.sqlite')` is '.', which must not blow up.
    const file = join(dir, 'bare.sqlite')
    expect(() => {
      handle = createDb({ url: file })
    }).not.toThrow()
  })

  it('persists data across connections, which is the whole point of the volume', () => {
    const file = join(dir, 'sage-burner.sqlite')

    const first = createDb({ url: file })
    runMigrations(first.db)
    first.db
      .insert(event)
      .values({
        id: 'e0000000-0000-4000-8000-000000000001',
        name: 'The Burning Sage @ Hökås',
        slug: 'burning-sage-autumn-2026',
        start_date: '2026-10-02',
        end_date: '2026-10-04',
        welcome_markdown: '',
        member_cap: 42,
        created_at: '2026-07-28T10:00:00Z',
      })
      .run()
    first.close()

    handle = createDb({ url: file })
    expect(handle.db.select().from(event).all()).toHaveLength(1)
  })
})
