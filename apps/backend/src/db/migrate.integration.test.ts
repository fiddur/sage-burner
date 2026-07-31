import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { DbHandle } from './client.ts'

import { createDb } from './client.ts'
import { migrationsFolder, runMigrations } from './migrate.ts'

/**
 * Upgrading a database that already holds rows.
 *
 * Every other suite migrates an empty database, which only ever exercises the
 * `CREATE TABLE`s. A table rebuild — SQLite's only way to drop a column or add a
 * CHECK — is `CREATE __new_x`, `INSERT … SELECT`, `DROP`, rename, and the copy is
 * where existing rows meet constraints that did not exist when they were written.
 *
 * That failure is not recoverable in place. Drizzle records a migration only once
 * it completes, so an aborted copy is retried on the next boot and aborts again —
 * and deployment here is watchtower pulling a new image unattended, so nobody is
 * watching when it starts failing. Hence a test rather than an inspection of the
 * production volume: "there are probably no rows" is an argument, and this is a
 * check.
 */

const BASE = '20260728153428_milky_miek'
const NOW = '2026-07-28T10:00:00Z'

let handle: DbHandle
let baseOnly: string
let temp: string

/** The migrations folder as it stood before this PR — used to build the "old" database. */
const folderWithOnlyTheBaseMigration = (into: string) => {
  const target = path.join(into, 'base-only')
  fs.mkdirSync(target, { recursive: true })
  fs.cpSync(path.join(migrationsFolder, BASE), path.join(target, BASE), { recursive: true })

  return target
}

beforeEach(() => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sage-burner-migrate-'))
  baseOnly = folderWithOnlyTheBaseMigration(temp)
  handle = createDb({ url: path.join(temp, 'legacy.sqlite') })
})

afterEach(() => {
  handle.client.close()
  fs.rmSync(temp, { recursive: true, force: true })
})

describe('migrating a database that already has form questions', () => {
  const seed = () => {
    // Applied through the real migrator rather than by executing the SQL by hand,
    // so drizzle's own bookkeeping matches a deployed volume: the base migration
    // recorded as done, the new one not yet seen.
    runMigrations(handle, baseOnly)

    const event = handle.client.prepare(
      'insert into event (id, slug, name, start_date, end_date, welcome_markdown, member_cap, created_at) values (?,?,?,?,?,?,?,?)',
    )
    event.run('ev-1', 'summer-2026', 'Summer', '2026-08-01', '2026-08-05', '', 42, NOW)
    event.run('ev-2', 'winter-2026', 'Winter', '2026-12-01', '2026-12-05', '', 42, NOW)

    const question = handle.client.prepare(
      'insert into form_question (id, event_id, `order`, type, label, help_text, required, options) values (?,?,?,?,?,?,?,?)',
    )
    // The two rows that the tick-box CHECKs reject. Both were legal before this
    // PR — nothing enforced the rule then — so they are exactly what an existing
    // volume may contain.
    question.run('q-1', 'ev-1', 0, 'agreement', 'I agree to the 10+1 principles', null, 0, null)
    question.run('q-2', 'ev-2', 0, 'checkbox', 'Bring my own food', null, 1, null)
    // A row that already complies, to prove the copy is not rewriting everything.
    question.run('q-3', 'ev-1', 1, 'text', 'Your name', null, 0, null)
  }

  it('does not abort on rows the new constraints reject', () => {
    seed()

    expect(() => runMigrations(handle)).not.toThrow()
  })

  it('coerces those rows to the tick-box rule instead of dropping them', () => {
    seed()
    runMigrations(handle)

    // `agreement` must be required and `checkbox` must not be, so there is exactly
    // one legal value for each and coercing is not a guess. Anything else would
    // mean choosing between aborting the boot and silently deleting a question an
    // organiser wrote.
    expect(handle.client.prepare('select id, type, required from form_question order by id').all()).toEqual([
      { id: 'q-1', type: 'agreement', required: 1 },
      { id: 'q-2', type: 'checkbox', required: 0 },
      { id: 'q-3', type: 'text', required: 0 },
    ])
  })

  it('keeps questions from every event, since there is one set now', () => {
    seed()
    runMigrations(handle)

    // Dropping `event_id` merges the per-event sets into the single list this PR
    // introduces. `order` is not unique, so the collision between ev-1 and ev-2
    // both holding order 0 is not a constraint failure — the result is one list an
    // organiser reorders, not a lost question.
    expect(handle.client.prepare('select count(*) c from form_question').get()).toEqual({ c: 3 })
  })

  it('still migrates an empty database', () => {
    // The path every other suite takes, asserted here so a change aimed at the
    // rows above cannot quietly break the fresh-volume case.
    expect(() => runMigrations(handle)).not.toThrow()
    expect(handle.client.prepare('select count(*) c from form_question').get()).toEqual({ c: 0 })
  })
})
