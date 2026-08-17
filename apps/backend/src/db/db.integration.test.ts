import {
  connectionKinds,
  notificationCategories,
  threadEntityTypes,
  threadEntryKinds,
} from '@sage-burner/shared'
import { eq } from 'drizzle-orm'
import { cpSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { DbHandle } from './client.ts'

import { createDb } from './client.ts'
import { migrationsFolder, runMigrations } from './migrate.ts'
import {
  account,
  accountAllergy,
  accountRole,
  allergyItem,
  application,
  attendance,
  bringHand,
  bringItem,
  event,
  formQuestion,
  inviteToken,
  passkey,
  session,
  sessionHelper,
  sessionSupport,
  webauthnChallenge,
} from './schema.ts'

const ids = {
  account: 'a0000000-0000-4000-8000-000000000001',
  otherAccount: 'a0000000-0000-4000-8000-000000000002',
  event: 'e0000000-0000-4000-8000-000000000001',
  invite: 'i0000000-0000-4000-8000-000000000001',
  otherInvite: 'i0000000-0000-4000-8000-000000000002',
  attendance: 'm0000000-0000-4000-8000-000000000001',
  otherAttendance: 'm0000000-0000-4000-8000-000000000002',
}

const NOW = '2026-07-28T10:00:00Z'

let handle: DbHandle

const seedAccount = (id: string, email: string) =>
  handle.db.insert(account).values({ id, email, password_hash: null, created_at: NOW }).run()

const seedEvent = () =>
  handle.db
    .insert(event)
    .values({
      id: ids.event,
      name: 'The Burning Sage @ Hökås',
      slug: 'burning-sage-autumn-2026',
      start_date: '2026-10-02',
      end_date: '2026-10-04',
      welcome_markdown: '# Welcome',
      member_cap: 42,
      created_at: NOW,
    })
    .run()

const seedInvite = (id: string) =>
  handle.db
    .insert(inviteToken)
    .values({
      id,
      token_hash: `hash-of-token-${id}`,
      application_id: null,
      expires_at: '2026-09-01T00:00:00Z',
      used_at: null,
      created_by: ids.account,
    })
    .run()

const seedAttendance = (id: string, account_id: string) =>
  handle.db
    .insert(attendance)
    .values({
      id,
      event_id: ids.event,
      account_id,
      joined_at: NOW,
      arrival_date: null,
      departure_date: null,
      lodging_option_id: null,
      helping_other: null,
      notes: null,
      payment_status: 'unpaid',
      payment_date: null,
    })
    .run()

beforeEach(() => {
  handle = createDb({ url: ':memory:' })
  runMigrations(handle)
  seedAccount(ids.account, 'admin@example.org')
  seedEvent()
})

afterEach(() => {
  handle.close()
})

describe('migrations', () => {
  it('creates every table on a fresh database', () => {
    const names = handle.client
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name)

    for (const table of [
      'account',
      'account_role',
      'application',
      'event',
      'form_question',
      'invite_token',
      'attendance',
      'passkey',
      'session',
    ]) {
      expect(names).toContain(table)
    }
  })

  it('checks every vocabulary against the one the code has, not the one it had', () => {
    const listed = (table: string, check: string): string[] => {
      const held = handle.client
        .prepare('select sql from sqlite_master where type = ? and name = ?')
        .get('table', table)?.sql
      const sql = typeof held === 'string' ? held : ''
      const found = new RegExp(`["\`]${check}["\`][^(]*\\(([^)]*)\\)`, 'u').exec(sql)?.[1] ?? ''
      const values = [...found.matchAll(/'([^']*)'/gu)].map((one) => one[1] ?? '')

      expect(values, `${table}.${check}`).not.toHaveLength(0)

      return values.toSorted()
    }

    const vocabularies: [string, string, readonly string[]][] = [
      ['notification', 'notification_category_check', notificationCategories],
      ['notification_setting', 'notification_setting_category_check', notificationCategories],
      ['thread', 'thread_entity_type_check', threadEntityTypes],
      ['thread_entry', 'thread_entry_kind_check', threadEntryKinds],
      ['account_connection', 'account_connection_kind_check', connectionKinds],
    ]

    for (const [table, check, vocabulary] of vocabularies) {
      expect(listed(table, check), `${table}.${check}`).toEqual([...vocabulary].toSorted())
    }
  })

  it('leaves each rebuilt table with the indexes it has now, not the ones it once had', () => {
    const indexes = (table: string): string[] =>
      handle.client
        .prepare("select name from sqlite_master where type = 'index' and tbl_name = ? and sql is not null")
        .all(table)
        .flatMap((row) => (typeof row.name === 'string' ? [row.name] : []))
        .toSorted()

    expect(indexes('thread_entry')).toEqual(['thread_entry_seq_idx'])
    expect(indexes('thread')).toEqual(['thread_entity_idx', 'thread_event_idx', 'thread_subject_idx'])
    expect(indexes('notification')).toEqual(['notification_account_idx'])
  })

  const leftovers = () =>
    readFileSync(path.join(migrationsFolder, '20260813160000_meeting_leftovers', 'migration.sql'), 'utf8')
      .split('--> statement-breakpoint')
      .filter((statement) => !statement.includes('`activity`'))
      .join('')

  const givenMeeting = (id: string, author: string | null = null) => {
    handle.client
      .prepare(
        'insert into meeting (id, event_id, author_account_id, title, starts_at, notes, created_at) ' +
          'values (?,?,?,?,?,?,?)',
      )
      .run(id, ids.event, author, 'Planning call', '2026-08-20T17:00:00.000Z', '', '2026-08-13T09:00:00.000Z')
  }

  const givenThread = (id: string, type: string, entityId: string) => {
    handle.client
      .prepare('insert into thread (id, event_id, entity_type, entity_id, title) values (?,?,?,?,?)')
      .run(id, ids.event, type, entityId, 'Planning call')
    handle.client
      .prepare(
        'insert into thread_entry (id, thread_id, kind, seq, author_account_id, body, created_at) ' +
          'values (?,?,?,?,?,?,?)',
      )
      .run(`${id}-e`, id, 'scheduled', 1, ids.account, 'put it in the diary', '2026-08-13T09:00:00.000Z')
  }

  it('sweeps out a card whose meeting is gone, and the conversation stranded under it', () => {
    givenMeeting('m-live')
    givenThread('t-gone', 'meeting', 'm-vanished')
    givenThread('t-live', 'meeting', 'm-live')

    handle.client.exec(leftovers())

    expect(handle.client.prepare('select id from thread order by id').all()).toEqual([{ id: 't-live' }])
    expect(handle.client.prepare('select thread_id from thread_entry').all()).toEqual([
      { thread_id: 't-live' },
    ])
  })

  it('does the same for a talking point, and leaves every other kind of card alone', () => {
    givenThread('t-point', 'point', 'p-vanished')
    givenThread('t-song', 'song', 'whatever-song')

    handle.client.exec(leftovers())

    expect(handle.client.prepare('select id from thread order by id').all()).toEqual([{ id: 't-song' }])
  })

  const meetingCards = () =>
    readFileSync(path.join(migrationsFolder, '20260813180000_meeting_cards', 'migration.sql'), 'utf8')

  const cardsOn = (entityId: string) =>
    handle.client
      .prepare(
        'select `entry`.`kind`, `entry`.`author_account_id`, `entry`.`body`, `entry`.`created_at` ' +
          'from `thread` `card` join `thread_entry` `entry` on `entry`.`thread_id` = `card`.`id` ' +
          "where `card`.`entity_type` = 'meeting' and `card`.`entity_id` = ? order by `entry`.`seq`",
      )
      .all(entityId)

  it('opens a card for a meeting that never had one, dated from when it was planned', () => {
    givenMeeting('m-old', ids.account)

    handle.client.exec(meetingCards())

    expect(cardsOn('m-old')).toEqual([
      {
        kind: 'scheduled',
        author_account_id: ids.account,
        body: 'put it in the diary',
        created_at: '2026-08-13T09:00:00.000Z',
      },
    ])
  })

  it('says somebody planned it when the row predates the column that would say who', () => {
    givenMeeting('m-older')

    handle.client.exec(meetingCards())

    expect(cardsOn('m-older').map((row) => row.author_account_id)).toEqual([null])
  })

  it('gives a card that already exists no second beginning', () => {
    givenMeeting('m-live', ids.account)
    givenThread('t-live', 'meeting', 'm-live')

    handle.client.exec(meetingCards())

    expect(handle.client.prepare('select id from thread order by id').all()).toEqual([{ id: 't-live' }])
    expect(handle.client.prepare('select id from thread_entry order by id').all()).toEqual([
      { id: 't-live-e' },
    ])
  })

  it('opens one that reaches the wire, `thread.id` being a uuid there', () => {
    givenMeeting('m-old', ids.account)

    handle.client.exec(meetingCards())

    const [row] = handle.client.prepare('select id from thread').all()
    expect(row?.id).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/u)
  })

  it('is idempotent — running again on the same database is a no-op', () => {
    expect(() => runMigrations(handle)).not.toThrow()
    expect(handle.db.select().from(event).all()).toHaveLength(1)
  })

  it('restores foreign key enforcement afterwards', () => {
    expect(handle.client.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1)
  })

  it('restores foreign key enforcement even when a migration throws', () => {
    expect(() => runMigrations(handle, '/nonexistent/migrations')).toThrow()
    expect(handle.client.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1)
  })

  it('refuses to migrate when foreign keys cannot be disabled', () => {
    handle.client.exec('BEGIN')
    try {
      expect(() => runMigrations(handle)).toThrow(/disable foreign keys/i)
    } finally {
      handle.client.exec('ROLLBACK')
    }
  })

  it('refuses to finish if a migration left a dangling reference', () => {
    seedInvite(ids.invite)
    seedAttendance(ids.attendance, ids.account)

    handle.client.exec('PRAGMA foreign_keys = OFF')
    handle.client.exec(`DELETE FROM event WHERE id = '${ids.event}'`)
    handle.client.exec('PRAGMA foreign_keys = ON')

    expect(() => runMigrations(handle)).toThrow(/foreign key violation/i)
    expect(handle.client.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1)
  })
})

describe('foreign keys', () => {
  it('are on — pinned by createDb rather than inherited from the driver', () => {
    const enabled = handle.client.prepare('PRAGMA foreign_keys').get()
    expect(enabled?.foreign_keys).toBe(1)
  })

  it('rejects a member pointing at an event that does not exist', () => {
    seedInvite(ids.invite)
    expect(() =>
      handle.db
        .insert(attendance)
        .values({
          id: ids.attendance,
          event_id: 'e0000000-0000-4000-8000-00000000dead',
          account_id: ids.account,
          joined_at: NOW,
          payment_status: 'unpaid',
        })
        .run(),
    ).toThrow()
  })

  it('cascades an event deletion to everything scoped to it', () => {
    seedInvite(ids.invite)
    seedAttendance(ids.attendance, ids.account)
    handle.db
      .insert(session)
      .values({
        id: 's1',
        event_id: ids.event,
        title: 'Cacao ceremony',
        facilitator_attendance_id: ids.attendance,
        description: 'Bring a cup.',
      })
      .run()

    handle.db.delete(event).where(eq(event.id, ids.event)).run()

    expect(handle.db.select().from(attendance).all()).toHaveLength(0)
    expect(handle.db.select().from(session).all()).toHaveLength(0)
  })

  it('takes a dream’s helpers and hearts with it when the dream goes', () => {
    seedAttendance(ids.attendance, ids.account)
    handle.db
      .insert(session)
      .values({ id: 's1', event_id: ids.event, title: 'Cacao ceremony', description: '' })
      .run()
    handle.db.insert(sessionHelper).values({ session_id: 's1', attendance_id: ids.attendance }).run()
    handle.db.insert(sessionSupport).values({ session_id: 's1', attendance_id: ids.attendance }).run()

    handle.db.delete(session).where(eq(session.id, 's1')).run()

    expect(handle.db.select().from(sessionHelper).all()).toHaveLength(0)
    expect(handle.db.select().from(sessionSupport).all()).toHaveLength(0)
  })

  it('takes them with the person when they withdraw from the burn', () => {
    seedAttendance(ids.attendance, ids.account)
    handle.db
      .insert(session)
      .values({ id: 's1', event_id: ids.event, title: 'Cacao ceremony', description: '' })
      .run()
    handle.db.insert(sessionHelper).values({ session_id: 's1', attendance_id: ids.attendance }).run()
    handle.db.insert(sessionSupport).values({ session_id: 's1', attendance_id: ids.attendance }).run()

    handle.db.delete(attendance).where(eq(attendance.id, ids.attendance)).run()

    expect(handle.db.select().from(sessionHelper).all()).toHaveLength(0)
    expect(handle.db.select().from(sessionSupport).all()).toHaveLength(0)
    expect(handle.db.select().from(session).all()).toHaveLength(1)
  })

  it('withdraws a pledge to bring something when the person leaves the burn', () => {
    seedAttendance(ids.attendance, ids.account)
    handle.db
      .insert(bringItem)
      .values({ id: 'b1', event_id: ids.event, title: 'Huge speakers', created_at: NOW })
      .run()
    handle.db.insert(bringHand).values({ item_id: 'b1', attendance_id: ids.attendance }).run()

    handle.db.delete(attendance).where(eq(attendance.id, ids.attendance)).run()

    expect(handle.db.select().from(bringHand).all()).toHaveLength(0)
    expect(handle.db.select().from(bringItem).all()).toHaveLength(1)
  })

  it('keeps the item when its author’s account is what goes, leaving nobody named', () => {
    handle.db
      .insert(bringItem)
      .values({
        id: 'b1',
        event_id: ids.event,
        author_account_id: ids.account,
        title: 'Huge speakers',
        created_at: NOW,
      })
      .run()

    handle.db.delete(account).where(eq(account.id, ids.account)).run()

    expect(handle.db.select().from(bringItem).all()).toEqual([
      expect.objectContaining({ id: 'b1', author_account_id: null }),
    ])
  })

  it('empties a dream’s facilitator spot when they leave the burn', () => {
    seedAttendance(ids.attendance, ids.account)
    handle.db
      .insert(session)
      .values({
        id: 's1',
        event_id: ids.event,
        title: 'Cacao ceremony',
        facilitator_attendance_id: ids.attendance,
        description: '',
      })
      .run()

    handle.db.delete(attendance).where(eq(attendance.id, ids.attendance)).run()

    expect(handle.db.select().from(session).all()[0]?.facilitator_attendance_id).toBeNull()
  })

  it('leaves the dream itself standing, vacant rather than deleted', () => {
    seedAttendance(ids.attendance, ids.account)
    handle.db
      .insert(session)
      .values({
        id: 's1',
        event_id: ids.event,
        title: 'Cacao ceremony',
        facilitator_attendance_id: ids.attendance,
        description: '',
      })
      .run()

    handle.db.delete(attendance).where(eq(attendance.id, ids.attendance)).run()

    expect(handle.db.select().from(session).all()).toHaveLength(1)
  })

  it('refuses a second heart from the same person, which is what makes the count sound', () => {
    seedAttendance(ids.attendance, ids.account)
    handle.db
      .insert(session)
      .values({ id: 's1', event_id: ids.event, title: 'Cacao ceremony', description: '' })
      .run()
    handle.client
      .prepare('insert into session_support (session_id, attendance_id) values (?, ?)')
      .run('s1', ids.attendance)

    expect(() =>
      handle.client
        .prepare('insert into session_support (session_id, attendance_id) values (?, ?)')
        .run('s1', ids.attendance),
    ).toThrow()
  })

  it('leaves the questions and the applications alone, since neither belongs to an event', () => {
    handle.db
      .insert(formQuestion)
      .values({ id: 'q1', order: 0, type: 'text', label: 'Why do you want to join?', required: true })
      .run()
    handle.db
      .insert(application)
      .values({
        id: 'app1',
        answers: [{ question_id: 'q1', label: 'Why do you want to join?', type: 'text', value: 'because' }],
        status: 'pending',
        applicant_name: 'Someone',
        applicant_email: 'someone@example.org',
        submitted_at: NOW,
      })
      .run()

    handle.db.delete(event).where(eq(event.id, ids.event)).run()

    expect(handle.db.select().from(formQuestion).all()).toHaveLength(1)
    expect(handle.db.select().from(application).all()).toHaveLength(1)
  })
})

describe('uniqueness', () => {
  it('allows only one membership per account per event', () => {
    seedInvite(ids.invite)
    seedInvite(ids.otherInvite)
    seedAttendance(ids.attendance, ids.account)

    expect(() => seedAttendance(ids.otherAttendance, ids.account)).toThrow()
  })

  it('lets the same account be a member of a different event', () => {
    seedInvite(ids.invite)
    seedAttendance(ids.attendance, ids.account)

    handle.db
      .insert(event)
      .values({
        id: 'e0000000-0000-4000-8000-000000000002',
        name: 'Next burn',
        slug: 'next-burn',
        start_date: '2027-01-01',
        end_date: '2027-01-03',
        member_cap: 42,
        created_at: NOW,
      })
      .run()
    handle.db
      .insert(inviteToken)
      .values({
        id: 'i0000000-0000-4000-8000-000000000003',
        token_hash: 'hash-of-token-next',
        expires_at: '2026-12-01T00:00:00Z',
        created_by: ids.account,
      })
      .run()

    expect(() =>
      handle.db
        .insert(attendance)
        .values({
          id: ids.otherAttendance,
          event_id: 'e0000000-0000-4000-8000-000000000002',
          account_id: ids.account,
          joined_at: NOW,
          payment_status: 'unpaid',
        })
        .run(),
    ).not.toThrow()
  })

  it('rejects a reused invite token digest', () => {
    seedInvite(ids.invite)
    expect(() =>
      handle.db
        .insert(inviteToken)
        .values({
          id: ids.otherInvite,
          token_hash: `hash-of-token-${ids.invite}`,
          expires_at: '2026-09-01T00:00:00Z',
          created_by: ids.account,
        })
        .run(),
    ).toThrow()
  })

  it('rejects a duplicate account email', () => {
    expect(() => seedAccount(ids.otherAccount, 'admin@example.org')).toThrow()
  })

  it('allows only one invite per application, so one approval is one membership', () => {
    handle.db
      .insert(application)
      .values({
        id: 'app-dup',
        answers: [],
        status: 'approved',
        applicant_name: 'Someone',
        applicant_email: 'someone@example.org',
        submitted_at: NOW,
        decided_at: NOW,
      })
      .run()

    const mint = (id: string) =>
      handle.db
        .insert(inviteToken)
        .values({
          id,
          token_hash: `hash-of-${id}`,
          application_id: 'app-dup',
          expires_at: '2026-09-01T00:00:00Z',
          created_by: ids.account,
        })
        .run()

    expect(() => mint('inv-1')).not.toThrow()
    expect(() => mint('inv-2')).toThrow()
  })

  it('still allows many direct admin invites, which carry no application', () => {
    expect(() => seedInvite(ids.invite)).not.toThrow()
    expect(() => seedInvite(ids.otherInvite)).not.toThrow()
  })

  it('refuses a mixed-case email, so one human cannot become two accounts', () => {
    expect(() => seedAccount(ids.otherAccount, 'Admin@Example.org')).toThrow()
    expect(() => seedAccount(ids.otherAccount, 'someone.else@example.org')).not.toThrow()
  })

  it('refuses a digest choice the app has no word for', () => {
    expect(() =>
      handle.client.prepare('update account set digest = ? where id = ?').run('hourly', ids.account),
    ).toThrow()
    expect(() =>
      handle.client.prepare('update account set digest = ? where id = ?').run('weekly', ids.account),
    ).not.toThrow()
    expect(() =>
      handle.client.prepare('update account set digest = ? where id = ?').run(null, ids.account),
    ).not.toThrow()
  })

  it('makes an invite genuinely single-use, even by a different account', () => {
    seedInvite(ids.invite)
    seedAccount(ids.otherAccount, 'someone.else@example.org')
    handle.db.update(account).set({ invite_token_id: ids.invite }).where(eq(account.id, ids.account)).run()

    expect(() =>
      handle.db
        .update(account)
        .set({ invite_token_id: ids.invite })
        .where(eq(account.id, ids.otherAccount))
        .run(),
    ).toThrow()
  })

  it('lets many accounts carry no invite, since the CLI creates them that way', () => {
    seedAccount(ids.otherAccount, 'someone.else@example.org')

    expect(
      handle.db
        .select()
        .from(account)
        .all()
        .filter((row) => row.invite_token_id === null),
    ).toHaveLength(2)
  })

  it('rejects a NULL primary key, which SQLite would otherwise allow', () => {
    expect(() =>
      handle.client
        .prepare(
          `INSERT INTO event (id, name, slug, start_date, end_date, welcome_markdown, member_cap, created_at)
           VALUES (NULL, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('Nameless', 'nameless', '2026-10-02', '2026-10-04', '', 42, NOW),
    ).toThrow()
  })
})

describe('check constraints', () => {
  const insertAttendance = (paymentStatus: string) =>
    handle.client
      .prepare(
        `INSERT INTO attendance (id, event_id, account_id, joined_at, payment_status)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(ids.attendance, ids.event, ids.account, NOW, paymentStatus)

  const insertPost = (title: string) =>
    handle.client
      .prepare('INSERT INTO post (id, event_id, title, created_at) VALUES (?, ?, ?, ?)')
      .run(`p-${title.length}-${Math.random()}`, ids.event, title, NOW)

  const insertSong = (title: string, capo: number | null = null) =>
    handle.client
      .prepare('INSERT INTO song (id, title, capo, created_at) VALUES (?, ?, ?, ?)')
      .run(`s-${Math.random()}`, title, capo, NOW)

  const insertBringItem = (title: string) =>
    handle.client
      .prepare('INSERT INTO bring_item (id, event_id, title, created_at) VALUES (?, ?, ?, ?)')
      .run(`b-${Math.random()}`, ids.event, title, NOW)

  it('rejects an announcement with nothing but whitespace for a title', () => {
    expect(() => insertPost('   ')).toThrow()
  })

  it('accepts one with a title, so the rejection above is the CHECK and not the statement', () => {
    expect(() => insertPost('The planning call is Sunday')).not.toThrow()
  })

  it('rejects a song with nothing but whitespace for a title', () => {
    expect(() => insertSong('  ')).toThrow()
  })

  it('rejects something to bring with nothing but whitespace for a name', () => {
    expect(() => insertBringItem('   ')).toThrow()
  })

  it('accepts one with a name, so the rejection above is the CHECK and not the statement', () => {
    expect(() => insertBringItem('Drums to use around the fire')).not.toThrow()
  })

  it('rejects a capo off the end of the neck, either way', () => {
    expect(() => insertSong('Fire in the sky', 12)).toThrow()
    expect(() => insertSong('Fire in the sky', -1)).toThrow()
  })

  it('accepts a song with a title and a capo on it, so those rejections are the CHECKs', () => {
    expect(() => insertSong('Fire in the sky', 11)).not.toThrow()
    expect(() => insertSong('Ashes', 0)).not.toThrow()
    expect(() => insertSong('Embers')).not.toThrow()
  })

  it('rejects a song category with no label, or an order below zero', () => {
    const insertCategory = (label: string, order: number) =>
      handle.client
        .prepare('INSERT INTO song_category (id, "order", label) VALUES (?, ?, ?)')
        .run(`sc-${Math.random()}`, order, label)

    expect(() => insertCategory(' ', 0)).toThrow()
    expect(() => insertCategory('Round', -1)).toThrow()
    expect(() => insertCategory('Round', 0)).not.toThrow()
  })

  it('rejects a payment status outside the shared vocabulary', () => {
    expect(() => insertAttendance('refunded')).toThrow()
  })

  it('accepts one inside it, so the rejection above is the CHECK and not the statement', () => {
    expect(() => insertAttendance('unpaid')).not.toThrow()
  })

  it('rejects an unknown role', () => {
    expect(() =>
      handle.client
        .prepare('INSERT INTO account_role (account_id, role) VALUES (?, ?)')
        .run(ids.account, 'superuser'),
    ).toThrow()
    expect(() =>
      handle.db.insert(accountRole).values({ account_id: ids.account, role: 'admin' }).run(),
    ).not.toThrow()
  })

  it('rejects an unknown application status', () => {
    expect(() =>
      handle.client
        .prepare(
          `INSERT INTO application (id, event_id, answers, status, applicant_name, applicant_email, submitted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('app2', ids.event, '{}', 'maybe', 'Someone', 'a@b.c', NOW),
    ).toThrow()
  })

  it('rejects an event that ends before it starts', () => {
    expect(() =>
      handle.client
        .prepare(
          `INSERT INTO event (id, name, slug, start_date, end_date, welcome_markdown, member_cap, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('e-bad', 'Backwards', 'backwards', '2026-10-04', '2026-10-02', '', 42, NOW),
    ).toThrow()
  })

  it('rejects a non-positive member cap', () => {
    expect(() =>
      handle.client
        .prepare(
          `INSERT INTO event (id, name, slug, start_date, end_date, welcome_markdown, member_cap, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('e-cap', 'Nobody', 'nobody', '2026-10-02', '2026-10-04', '', 0, NOW),
    ).toThrow()
  })

  const insertStay = (arrival: string, departure: string) =>
    handle.client
      .prepare(
        `INSERT INTO attendance (id, event_id, account_id, joined_at, arrival_date, departure_date, payment_status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(ids.attendance, ids.event, ids.account, NOW, arrival, departure, 'unpaid')

  it('rejects a member departing before they arrive', () => {
    expect(() => insertStay('2026-10-04', '2026-10-02')).toThrow()
  })

  it('accepts the same row with the dates in order', () => {
    expect(() => insertStay('2026-10-02', '2026-10-04')).not.toThrow()
  })

  it('rejects half a time slot', () => {
    expect(() =>
      handle.client
        .prepare(
          `INSERT INTO session (id, event_id, title, facilitator_account_id, description, time_slot_start, time_slot_end)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('s-half', ids.event, 'Half a slot', ids.account, '', '2026-10-03T09:00:00Z', null),
    ).toThrow()
  })

  it('rejects a malformed date, which the ordering checks depend on', () => {
    expect(() =>
      handle.client
        .prepare(
          `INSERT INTO event (id, name, slug, start_date, end_date, welcome_markdown, member_cap, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('e-loose', 'Loose', 'loose', '2026-1-2', '2026-10-04', '', 42, NOW),
    ).toThrow()
  })

  it('still accepts a null date, since arrival and departure are optional', () => {
    seedInvite(ids.invite)
    expect(() => seedAttendance(ids.attendance, ids.account)).not.toThrow()
  })

  it('rejects a negative question order', () => {
    expect(() =>
      handle.client
        .prepare('INSERT INTO form_question (id, "order", type, label, required) VALUES (?, ?, ?, ?, ?)')
        .run('q-neg', -1, 'text', 'Why?', 1),
    ).toThrow()
  })

  it('rejects a non-boolean required flag, which SQLite would otherwise store', () => {
    expect(() =>
      handle.client
        .prepare('INSERT INTO form_question (id, "order", type, label, required) VALUES (?, ?, ?, ?, ?)')
        .run('q-seven', 0, 'text', 'Why?', 7),
    ).toThrow()
  })

  it('rejects an agreement question that is not required', () => {
    expect(() =>
      handle.client
        .prepare('INSERT INTO form_question (id, "order", type, label, required) VALUES (?, ?, ?, ?, ?)')
        .run('q-optional-agreement', 0, 'agreement', 'I agree', 0),
    ).toThrow()

    expect(() =>
      handle.client
        .prepare('INSERT INTO form_question (id, "order", type, label) VALUES (?, ?, ?, ?)')
        .run('q-defaulted-agreement', 1, 'agreement', 'I agree'),
    ).toThrow()
  })

  it('rejects a required checkbox question', () => {
    expect(() =>
      handle.client
        .prepare('INSERT INTO form_question (id, "order", type, label, required) VALUES (?, ?, ?, ?, ?)')
        .run('q-required-checkbox', 3, 'checkbox', 'Tick if vegan', 1),
    ).toThrow()
  })

  it('still accepts an optional checkbox question', () => {
    expect(() =>
      handle.client
        .prepare('INSERT INTO form_question (id, "order", type, label, required) VALUES (?, ?, ?, ?, ?)')
        .run('q-good-checkbox', 4, 'checkbox', 'Tick if vegan', 0),
    ).not.toThrow()
  })

  it('still accepts a required agreement question', () => {
    expect(() =>
      handle.client
        .prepare('INSERT INTO form_question (id, "order", type, label, required) VALUES (?, ?, ?, ?, ?)')
        .run('q-good-agreement', 2, 'agreement', 'I agree', 1),
    ).not.toThrow()
  })

  it('rejects a question type the form cannot render', () => {
    expect(() =>
      handle.client
        .prepare('INSERT INTO form_question (id, "order", type, label, required) VALUES (?, ?, ?, ?, ?)')
        .run('q2', 0, 'select', 'Pick one', 1),
    ).toThrow()
  })
})

describe('passkeys', () => {
  const seedPasskey = (id: string, credential_id: string, account_id = ids.account) =>
    handle.db
      .insert(passkey)
      .values({
        id,
        account_id,
        credential_id,
        public_key: 'cHVibGljLWtleQ==',
        counter: 0,
        label: 'Phone',
        created_at: NOW,
      })
      .run()

  it('lets one account register several', () => {
    expect(() => seedPasskey('pk1', 'cred-1')).not.toThrow()
    expect(() => seedPasskey('pk2', 'cred-2')).not.toThrow()
  })

  it('rejects a credential id already registered', () => {
    seedPasskey('pk1', 'cred-1')
    expect(() => seedPasskey('pk2', 'cred-1')).toThrow()
  })

  it('rejects a negative signature counter', () => {
    const insert = (counter: number) =>
      handle.client
        .prepare(
          `INSERT INTO passkey (id, account_id, credential_id, public_key, counter, label, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(`pk-${counter}`, ids.account, `cred-${counter}`, 'key', counter, 'Phone', NOW)

    expect(() => insert(0)).not.toThrow()
    expect(() => insert(-1)).toThrow()
  })

  it('goes away with the account it belongs to', () => {
    seedAccount(ids.otherAccount, 'someone.else@example.org')
    seedPasskey('pk1', 'cred-1', ids.otherAccount)

    handle.db.delete(account).where(eq(account.id, ids.otherAccount)).run()

    expect(handle.db.select().from(passkey).all()).toHaveLength(0)
  })
})

describe('webauthn challenges', () => {
  it('keeps one row per challenge', () => {
    const mint = (challenge: string) =>
      handle.db.insert(webauthnChallenge).values({ challenge, account_id: null, expires_at: NOW }).run()

    expect(() => mint('c1')).not.toThrow()
    expect(() => mint('c1')).toThrow()
  })

  it('goes away with the account that asked for it', () => {
    seedAccount(ids.otherAccount, 'someone.else@example.org')
    handle.db
      .insert(webauthnChallenge)
      .values({ challenge: 'c1', account_id: ids.otherAccount, expires_at: NOW })
      .run()

    handle.db.delete(account).where(eq(account.id, ids.otherAccount)).run()

    expect(handle.db.select().from(webauthnChallenge).all()).toHaveLength(0)
  })
})

describe('account deletion', () => {
  it('is blocked for an account that has issued invites', () => {
    seedInvite(ids.invite)
    expect(() => handle.db.delete(account).where(eq(account.id, ids.account)).run()).toThrow()
  })

  it('is blocked for an account that is a member somewhere', () => {
    seedAccount(ids.otherAccount, 'someone.else@example.org')
    seedInvite(ids.invite)
    seedAttendance(ids.attendance, ids.otherAccount)

    expect(() => handle.db.delete(account).where(eq(account.id, ids.otherAccount)).run()).toThrow()
  })

  it('is allowed for an account with no history', () => {
    seedAccount(ids.otherAccount, 'someone.else@example.org')
    expect(() => handle.db.delete(account).where(eq(account.id, ids.otherAccount)).run()).not.toThrow()
  })
})

describe('transactions', () => {
  it('rolls back every write when the body throws', () => {
    seedInvite(ids.invite)

    expect(() =>
      handle.db.transaction((tx) => {
        tx.insert(attendance)
          .values({
            id: ids.attendance,
            event_id: ids.event,
            account_id: ids.account,
            joined_at: NOW,
            payment_status: 'unpaid',
          })
          .run()
        throw new Error('redemption failed halfway')
      }),
    ).toThrow('redemption failed halfway')

    expect(handle.db.select().from(attendance).all()).toHaveLength(0)
  })
})

describe('sessions', () => {
  it('accepts an unscheduled dream — the normal state before the burn', () => {
    seedInvite(ids.invite)
    seedAttendance(ids.attendance, ids.account)

    handle.db
      .insert(session)
      .values({
        id: 's2',
        event_id: ids.event,
        title: 'Something unplanned',
        facilitator_attendance_id: ids.attendance,
        description: '',
        time_slot_start: null,
        time_slot_end: null,
      })
      .run()

    const rows = handle.db.select().from(session).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.time_slot_start).toBeNull()
  })
})

describe('json columns', () => {
  it('round-trips application answers', () => {
    const answers = [
      { question_id: 'q-1', label: 'Why do you want to come?', type: 'text', value: 'a written answer' },
      { question_id: 'q-2', label: 'I agree to the principles', type: 'agreement', value: true },
    ] as const
    handle.db
      .insert(application)
      .values({
        id: 'app3',
        answers: [...answers],
        status: 'pending',
        applicant_name: 'Someone',
        applicant_email: 'someone@example.org',
        submitted_at: NOW,
      })
      .run()

    expect(handle.db.select().from(application).all()[0]?.answers).toEqual(answers)
  })
})

const REBUILD = '20260804105125_places_per_burn'
const THREADS = '20260809090000_threads'
const LOGIN_ADDRESS = '20260809180000_connection_messenger_email'
const FACILITATOR = '20260805040000_facilitator'
const REPEATABLE = '20260805050000_repeatable_dream'

const stagedThrough = (exclude: string) => {
  const staged = mkdtempSync(path.join(tmpdir(), 'sage-migrations-'))
  const kept = readdirSync(migrationsFolder)
    .filter((name) => name < exclude)
    .toSorted()

  for (const tag of kept) {
    cpSync(path.join(migrationsFolder, tag), path.join(staged, tag), { recursive: true })
  }

  return { staged, kept }
}

const beforeTheRebuild = () => {
  const fresh = createDb({ url: ':memory:' })
  const { staged, kept } = stagedThrough(REBUILD)

  expect(kept).not.toContain(REBUILD)
  expect(kept.length).toBeGreaterThan(0)

  runMigrations(fresh, staged)
  expect(columnsOf(fresh, 'place')).not.toContain('event_id')

  return fresh
}

const columnsOf = (db: DbHandle, table: string) =>
  db.client
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((row) => row.name)

const anEvent = (db: DbHandle, id: string, slug: string, created_at: string) =>
  db.client
    .prepare(
      'insert into event (id, name, slug, start_date, end_date, member_cap, created_at) values (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(id, slug, slug, '2026-10-02', '2026-10-04', 42, created_at)

describe('the places-per-burn migration', () => {
  const oldPlace = (db: DbHandle, id: string, order: number, name: string) =>
    db.client
      .prepare('insert into place (id, "order", name, emoji, color) values (?, ?, ?, ?, ?)')
      .run(id, order, name, '🛕', 'yellow')

  it('gives existing places to the last created event', () => {
    const fresh = beforeTheRebuild()
    try {
      anEvent(fresh, 'e-first', 'first-burn', '2025-01-01T00:00:00Z')
      anEvent(fresh, 'e-last', 'last-burn', '2026-01-01T00:00:00Z')
      anEvent(fresh, 'e-middle', 'middle-burn', '2025-06-01T00:00:00Z')
      oldPlace(fresh, 'p-1', 0, 'Temple')
      oldPlace(fresh, 'p-2', 1, 'Sauna')

      runMigrations(fresh)

      const rows = fresh.client
        .prepare('select id, event_id, "order", name from place order by "order"')
        .all()
      expect(rows).toEqual([
        { id: 'p-1', event_id: 'e-last', order: 0, name: 'Temple' },
        { id: 'p-2', event_id: 'e-last', order: 1, name: 'Sauna' },
      ])
    } finally {
      fresh.close()
    }
  })

  it('drops the places when there is no event to give them to', () => {
    const fresh = beforeTheRebuild()
    try {
      oldPlace(fresh, 'p-1', 0, 'Temple')

      runMigrations(fresh)

      expect(fresh.client.prepare('select count(*) as n from place').get()?.n).toBe(0)
      expect(columnsOf(fresh, 'place')).toContain('event_id')
    } finally {
      fresh.close()
    }
  })

  it('keeps a dream standing in a place it carried over', () => {
    const fresh = beforeTheRebuild()
    try {
      anEvent(fresh, 'e-last', 'last-burn', '2026-01-01T00:00:00Z')
      fresh.client
        .prepare('insert into account (id, email, created_at) values (?, ?, ?)')
        .run('a-1', 'host@example.org', NOW)
      oldPlace(fresh, 'p-1', 0, 'Temple')
      fresh.client
        .prepare(
          'insert into session (id, event_id, host_account_id, title, description, place_id) values (?, ?, ?, ?, ?, ?)',
        )
        .run('s-1', 'e-last', 'a-1', 'Sunrise yoga', '', 'p-1')

      runMigrations(fresh)

      expect(fresh.client.prepare('select place_id from session where id = ?').get('s-1')?.place_id).toBe(
        'p-1',
      )
      expect(fresh.client.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally {
      fresh.close()
    }
  })

  it('takes a burn’s places with it when the burn is deleted', () => {
    const fresh = createDb({ url: ':memory:' })
    try {
      runMigrations(fresh)
      anEvent(fresh, 'e-1', 'a-burn', '2026-01-01T00:00:00Z')
      fresh.client
        .prepare('insert into place (id, event_id, "order", name, emoji, color) values (?, ?, ?, ?, ?, ?)')
        .run('p-1', 'e-1', 0, 'Temple', '🛕', 'yellow')

      fresh.client.prepare('delete from event where id = ?').run('e-1')

      expect(fresh.client.prepare('select count(*) as n from place').get()?.n).toBe(0)
    } finally {
      fresh.close()
    }
  })
})

describe('the facilitator rename', () => {
  it('carries every host across as the facilitator, rather than dropping them', () => {
    const fresh = createDb({ url: ':memory:' })
    const { staged, kept } = stagedThrough(FACILITATOR)

    expect(kept).not.toContain(FACILITATOR)
    expect(kept).toContain(REBUILD)

    try {
      runMigrations(fresh, staged)
      expect(columnsOf(fresh, 'session')).toContain('host_account_id')

      anEvent(fresh, 'e-1', 'a-burn', '2026-01-01T00:00:00Z')
      fresh.client
        .prepare('insert into account (id, email, created_at) values (?, ?, ?)')
        .run('a-1', 'ada@example.org', NOW)
      fresh.client
        .prepare(
          'insert into session (id, event_id, host_account_id, title, description) values (?, ?, ?, ?, ?)',
        )
        .run('s-1', 'e-1', 'a-1', 'Sunrise yoga', '')

      runMigrations(fresh, stagedThrough(FACILITATOR_ATTENDANCE).staged)

      expect(columnsOf(fresh, 'session')).not.toContain('host_account_id')
      expect(
        fresh.client.prepare('select facilitator_account_id from session where id = ?').get('s-1')
          ?.facilitator_account_id,
      ).toBe('a-1')
      expect(fresh.client.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally {
      fresh.close()
    }
  })

  it('lets a dream have no facilitator at all, which the old column refused', () => {
    const fresh = createDb({ url: ':memory:' })
    try {
      runMigrations(fresh)
      anEvent(fresh, 'e-1', 'a-burn', '2026-01-01T00:00:00Z')

      fresh.client
        .prepare('insert into session (id, event_id, title, description) values (?, ?, ?, ?)')
        .run('s-1', 'e-1', 'Nobody yet', '')

      expect(
        fresh.client.prepare('select facilitator_attendance_id from session where id = ?').get('s-1')
          ?.facilitator_attendance_id,
      ).toBeNull()
    } finally {
      fresh.close()
    }
  })
})

describe('the repeatable-dream column', () => {
  it('leaves every dream that already existed a one-off', () => {
    const fresh = createDb({ url: ':memory:' })
    const { staged, kept } = stagedThrough(REPEATABLE)

    expect(kept).not.toContain(REPEATABLE)
    expect(kept).toContain(FACILITATOR)

    try {
      runMigrations(fresh, staged)
      expect(columnsOf(fresh, 'session')).not.toContain('repeatable')

      anEvent(fresh, 'e-1', 'a-burn', '2026-01-01T00:00:00Z')
      fresh.client
        .prepare('insert into session (id, event_id, title, description) values (?, ?, ?, ?)')
        .run('s-1', 'e-1', 'Sunrise yoga', '')

      runMigrations(fresh)

      expect(fresh.client.prepare('select repeatable from session where id = ?').get('s-1')?.repeatable).toBe(
        0,
      )
    } finally {
      fresh.close()
    }
  })
})

const FACILITATOR_ATTENDANCE = '20260806150000_facilitator_attendance'

const THREAD_SUBJECT_UNIQUE = '20260811120000_thread_subject_unique'

const SONG_LINK_URL_ONLY = '20260811140000_song_link_url_only'

const JOINED_CARDS = '20260811180000_joined_cards'

describe('the facilitator-is-an-attendance migration', () => {
  const beforeTheFacilitatorRebuild = () => {
    const fresh = createDb({ url: ':memory:' })
    const { staged, kept } = stagedThrough(FACILITATOR_ATTENDANCE)

    expect(kept).not.toContain(FACILITATOR_ATTENDANCE)
    expect(kept.length).toBeGreaterThan(0)

    runMigrations(fresh, staged)
    expect(columnsOf(fresh, 'session')).toContain('facilitator_account_id')

    return fresh
  }

  const seed = (db: DbHandle) => {
    anEvent(db, 'e-1', 'a-burn', '2026-01-01T00:00:00Z')
    anEvent(db, 'e-2', 'another-burn', '2026-02-01T00:00:00Z')
    const people: [string, string][] = [
      ['acc-coming', 'coming@example.org'],
      ['acc-away', 'away@example.org'],
    ]

    for (const [id, email] of people) {
      db.client.prepare('insert into account (id, email, created_at) values (?, ?, ?)').run(id, email, NOW)
    }
    for (const [id, eventId, accountId] of [
      ['att-1', 'e-1', 'acc-coming'],
      ['att-elsewhere', 'e-2', 'acc-away'],
    ] as [string, string, string][]) {
      db.client
        .prepare('insert into attendance (id, event_id, account_id, joined_at) values (?, ?, ?, ?)')
        .run(id, eventId, accountId, NOW)
    }

    const dreams: [string, string, string | null][] = [
      ['s-coming', 'Run by somebody attending', 'acc-coming'],
      ['s-away', 'Run by somebody who never joined', 'acc-away'],
      ['s-nobody', 'Offered by nobody in particular', null],
    ]

    for (const [id, title, who] of dreams) {
      db.client
        .prepare('insert into session (id, event_id, title, facilitator_account_id) values (?, ?, ?, ?)')
        .run(id, 'e-1', title, who)
    }
  }

  const facilitatorOf = (db: DbHandle, id: string) =>
    db.client.prepare('select facilitator_attendance_id as a from session where id = ?').get(id)?.a

  it('maps a facilitator to their attendance at that dream’s own burn', () => {
    const fresh = beforeTheFacilitatorRebuild()
    try {
      seed(fresh)

      runMigrations(fresh, migrationsFolder)

      expect(facilitatorOf(fresh, 's-coming')).toBe('att-1')
    } finally {
      fresh.close()
    }
  })

  it('drops a facilitator who was never attending, which is the new rule applied', () => {
    const fresh = beforeTheFacilitatorRebuild()
    try {
      seed(fresh)

      runMigrations(fresh, migrationsFolder)

      expect(facilitatorOf(fresh, 's-away')).toBeNull()
    } finally {
      fresh.close()
    }
  })

  it('keeps every dream, including the ones nobody was running', () => {
    const fresh = beforeTheFacilitatorRebuild()
    try {
      seed(fresh)

      runMigrations(fresh, migrationsFolder)

      expect(fresh.client.prepare('select count(*) as n from session').get()?.n).toBe(3)
      expect(facilitatorOf(fresh, 's-nobody')).toBeNull()
    } finally {
      fresh.close()
    }
  })
})

describe('the allergy list', () => {
  const LACTOSE = 'a11e0000-0000-4000-8000-000000000004'

  it('seeds the five the migration names, in order', () => {
    const labels = handle.client
      .prepare('SELECT label FROM allergy_item ORDER BY "order"')
      .all()
      .map((row) => row.label)

    expect(labels).toEqual([
      'Vegan',
      'Gluten (non-celiac)',
      'Strict gluten (celiac)',
      'Lactose',
      'Milk protein',
    ])
  })

  it('refuses to remove an item somebody has ticked', () => {
    handle.db.insert(accountAllergy).values({ account_id: ids.account, item_id: LACTOSE }).run()

    expect(() => handle.db.delete(allergyItem).where(eq(allergyItem.id, LACTOSE)).run()).toThrow()
  })

  it('removes one nobody has ticked', () => {
    expect(() => handle.db.delete(allergyItem).where(eq(allergyItem.id, LACTOSE)).run()).not.toThrow()
  })

  it('takes the ticks with the person when the account goes', () => {
    handle.db.insert(accountAllergy).values({ account_id: ids.account, item_id: LACTOSE }).run()

    handle.db.delete(account).where(eq(account.id, ids.account)).run()

    expect(handle.db.select().from(accountAllergy).all()).toHaveLength(0)
  })

  it('refuses the same item twice for one person', () => {
    handle.db.insert(accountAllergy).values({ account_id: ids.account, item_id: LACTOSE }).run()

    expect(() =>
      handle.db.insert(accountAllergy).values({ account_id: ids.account, item_id: LACTOSE }).run(),
    ).toThrow()
  })
})

describe('the threads migration', () => {
  const beforeTheThreads = () => {
    const fresh = createDb({ url: ':memory:' })
    const { staged, kept } = stagedThrough(THREADS)

    expect(kept).not.toContain(THREADS)
    expect(kept.length).toBeGreaterThan(0)

    runMigrations(fresh, staged)
    expect(fresh.client.prepare("select name from sqlite_master where name = 'thread'").get()).toBeUndefined()

    return fresh
  }

  it('gives every dream already offered a thread of its own, named as it is named', () => {
    const fresh = beforeTheThreads()

    try {
      anEvent(fresh, 'e-1', 'a-burn', NOW)
      for (const [id, title] of [
        ['s-1', 'Sauna at dawn'],
        ['s-2', 'Cacao ceremony'],
      ] as [string, string][]) {
        fresh.client
          .prepare('insert into session (id, event_id, title) values (?, ?, ?)')
          .run(id, 'e-1', title)
      }

      runMigrations(fresh, migrationsFolder)

      const threads = fresh.client
        .prepare('select entity_type, entity_id, title, event_id from thread order by entity_id')
        .all()

      expect(threads).toEqual([
        { entity_type: 'session', entity_id: 's-1', title: 'Sauna at dawn', event_id: 'e-1' },
        { entity_type: 'session', entity_id: 's-2', title: 'Cacao ceremony', event_id: 'e-1' },
      ])
      expect(fresh.client.prepare('select count(*) as n from thread_entry').get()?.n).toBe(0)
    } finally {
      fresh.close()
    }
  })

  it('gives each of them a distinct id', () => {
    const fresh = beforeTheThreads()

    try {
      anEvent(fresh, 'e-1', 'a-burn', NOW)
      for (const id of ['s-1', 's-2', 's-3']) {
        fresh.client.prepare('insert into session (id, event_id, title) values (?, ?, ?)').run(id, 'e-1', id)
      }

      runMigrations(fresh, migrationsFolder)

      const minted = fresh.client
        .prepare('select id from thread')
        .all()
        .map((row) => String(row.id))

      expect(new Set(minted).size).toBe(3)
      for (const id of minted) {
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      }
    } finally {
      fresh.close()
    }
  })

  it('keeps every notification already written while widening what one may be about', () => {
    const fresh = beforeTheThreads()

    try {
      anEvent(fresh, 'e-1', 'a-burn', NOW)
      fresh.client
        .prepare('insert into account (id, email, created_at) values (?, ?, ?)')
        .run('a-1', 'a@b.c', NOW)
      fresh.client
        .prepare(
          'insert into notification (id, account_id, category, body, created_at) values (?, ?, ?, ?, ?)',
        )
        .run('n-1', 'a-1', 'dream_offered', 'Ada offered a dream: Sauna', NOW)
      fresh.client
        .prepare('insert into notification_setting (account_id, category, enabled) values (?, ?, ?)')
        .run('a-1', 'dream_offered', 1)

      runMigrations(fresh, migrationsFolder)

      expect(fresh.client.prepare('select count(*) as n from notification').get()?.n).toBe(1)
      expect(fresh.client.prepare('select count(*) as n from notification_setting').get()?.n).toBe(1)

      expect(() =>
        fresh.client
          .prepare(
            'insert into notification (id, account_id, category, body, created_at) values (?, ?, ?, ?, ?)',
          )
          .run('n-2', 'a-1', 'dream_comment', 'Bea said something', NOW),
      ).not.toThrow()
    } finally {
      fresh.close()
    }
  })

  it('takes the feed’s one-line news away with its table, rows and all', () => {
    const fresh = beforeTheThreads()

    try {
      anEvent(fresh, 'e-1', 'a-burn', NOW)
      fresh.client
        .prepare('insert into activity (id, event_id, category, body, created_at) values (?, ?, ?, ?, ?)')
        .run('act-1', 'e-1', 'member_joined', 'Bea is coming.', NOW)

      runMigrations(fresh, migrationsFolder)

      expect(
        fresh.client.prepare("select name from sqlite_master where name = 'activity'").get(),
      ).toBeUndefined()
      expect(fresh.client.prepare('select count(*) as n from event').get()?.n).toBe(1)
    } finally {
      fresh.close()
    }
  })
})

describe('the login-address backfill', () => {
  it('gives every account already here its login address as a way to be reached', () => {
    const fresh = createDb({ url: ':memory:' })
    const { staged, kept } = stagedThrough(LOGIN_ADDRESS)

    try {
      expect(kept).not.toContain(LOGIN_ADDRESS)
      runMigrations(fresh, staged)

      const insertAccount = fresh.client.prepare(
        'insert into account (id, email, name, created_at) values (?, ?, ?, ?)',
      )
      insertAccount.run('a-1', 'ada@example.org', 'Ada', NOW)
      insertAccount.run('a-2', 'bea@example.org', 'Bea', NOW)
      insertAccount.run('a-3', 'cai@example.org', 'Cai', NOW)

      fresh.client
        .prepare(
          'insert into account_connection (id, account_id, kind, value, label, "order") values (?, ?, ?, ?, ?, ?)',
        )
        .run('c-1', 'a-1', 'discord', 'ada', '', 0)
      fresh.client
        .prepare(
          'insert into account_connection (id, account_id, kind, value, label, "order") values (?, ?, ?, ?, ?, ?)',
        )
        .run('c-2', 'a-2', 'email', 'ada.at.work@example.org', '', 0)

      runMigrations(fresh, migrationsFolder)

      const listFor = (accountId: string) =>
        fresh.client
          .prepare(
            'select kind, value, "order" from account_connection where account_id = ? order by "order"',
          )
          .all(accountId)
          .map((row) => `${String(row.kind)}:${String(row.value)}@${String(row.order)}`)

      expect(listFor('a-1')).toEqual(['discord:ada@0', 'email:ada@example.org@1'])
      expect(listFor('a-2')).toEqual(['email:ada.at.work@example.org@0'])
      expect(listFor('a-3')).toEqual(['email:cai@example.org@0'])
    } finally {
      fresh.close()
    }
  })
})

describe('the one-card-per-person-per-burn backfill', () => {
  const seed = (db: DbHandle) => {
    anEvent(db, 'e-1', 'a-burn', '2026-01-01T00:00:00Z')

    for (const [id, email, name] of [
      ['a-ada', 'ada@example.org', 'Ada'],
      ['a-bea', 'bea@example.org', 'Bea'],
      ['a-cai', 'cai@example.org', 'Cai'],
    ] as [string, string, string][]) {
      db.client
        .prepare('insert into account (id, email, name, created_at) values (?, ?, ?, ?)')
        .run(id, email, name, NOW)
    }

    for (const [id, accountId] of [
      ['att-bea-again', 'a-bea'],
      ['att-cai', 'a-cai'],
    ] as [string, string][]) {
      db.client
        .prepare('insert into attendance (id, event_id, account_id, joined_at) values (?, ?, ?, ?)')
        .run(id, 'e-1', accountId, NOW)
    }

    const aCard = db.client.prepare(
      'insert into thread (id, event_id, entity_type, entity_id, subject_account_id, title) values (?, ?, ?, ?, ?, ?)',
    )
    aCard.run('t-ada', 'e-1', 'attendance', 'att-ada-gone', null, 'Ada')
    aCard.run('t-bea-left', 'e-1', 'attendance', 'att-bea-gone', null, 'Bea')
    aCard.run('t-bea-back', 'e-1', 'attendance', 'att-bea-again', 'a-bea', 'Bea')
    aCard.run('t-cai', 'e-1', 'attendance', 'att-cai', 'a-cai', 'Cai')
    aCard.run('t-song', null, 'song', 'song-1', null, 'Fire in the sky')
    aCard.run('t-other-song', null, 'song', 'song-2', null, 'Dust in my boots')
    aCard.run('t-unknown', 'e-1', 'attendance', 'att-unknown', null, 'Somebody')
    aCard.run('t-unknown-too', 'e-1', 'attendance', 'att-unknown-2', null, 'Somebody else')

    const anEntry = db.client.prepare(
      'insert into thread_entry (id, thread_id, kind, seq, author_account_id, body, created_at) values (?, ?, ?, ?, ?, ?, ?)',
    )
    anEntry.run('x-ada-1', 't-ada', 'joined', 1, 'a-ada', 'is coming', '2026-07-01T10:00:00Z')
    anEntry.run('x-ada-2', 't-ada', 'comment', 2, 'a-cai', 'good to hear', '2026-07-02T10:00:00Z')
    anEntry.run('x-bea-1', 't-bea-left', 'joined', 1, 'a-bea', 'is coming', '2026-07-03T10:00:00Z')
    anEntry.run('x-bea-2', 't-bea-left', 'comment', 2, 'a-cai', 'see you there', '2026-07-04T10:00:00Z')
    anEntry.run('x-bea-3', 't-bea-back', 'joined', 1, 'a-bea', 'is coming', '2026-07-05T10:00:00Z')
    anEntry.run('x-bea-4', 't-bea-back', 'comment', 2, 'a-cai', 'again!', '2026-07-06T10:00:00Z')
    anEntry.run('x-cai-1', 't-cai', 'joined', 1, 'a-cai', 'is coming', '2026-07-07T10:00:00Z')
    anEntry.run('x-song-1', 't-song', 'added', 1, 'a-cai', 'put it in the book', '2026-07-08T10:00:00Z')
    anEntry.run('x-unknown', 't-unknown', 'scheduled', 1, null, 'moved it', '2026-07-09T10:00:00Z')
    anEntry.run('x-unknown-2', 't-unknown-too', 'scheduled', 1, null, 'moved it', '2026-07-09T11:00:00Z')
  }

  const beforeTheUniqueIndex = () => {
    const fresh = createDb({ url: ':memory:' })
    const { staged, kept } = stagedThrough(THREAD_SUBJECT_UNIQUE)

    expect(kept).not.toContain(THREAD_SUBJECT_UNIQUE)
    expect(kept.length).toBeGreaterThan(0)

    runMigrations(fresh, staged)
    expect(columnsOf(fresh, 'thread')).toContain('subject_account_id')

    return fresh
  }

  const subjectOf = (db: DbHandle, id: string) =>
    db.client.prepare('select subject_account_id as who from thread where id = ?').get(id)?.who

  const entriesOn = (db: DbHandle, id: string) =>
    db.client
      .prepare('select id, seq from thread_entry where thread_id = ? order by seq')
      .all(id)
      .map((row) => `${String(row.id)}@${String(row.seq)}`)

  it('recovers the person from the card’s first entry when their stay is already gone', () => {
    const fresh = beforeTheUniqueIndex()
    try {
      seed(fresh)

      runMigrations(fresh, migrationsFolder)

      expect(subjectOf(fresh, 't-ada')).toBe('a-ada')
    } finally {
      fresh.close()
    }
  })

  it('leaves a card that already knew whose it is alone, entries and numbering included', () => {
    const fresh = beforeTheUniqueIndex()
    try {
      seed(fresh)

      runMigrations(fresh, migrationsFolder)

      expect(subjectOf(fresh, 't-cai')).toBe('a-cai')
      expect(entriesOn(fresh, 't-cai')).toEqual(['x-cai-1@1'])
    } finally {
      fresh.close()
    }
  })

  it('merges the pair a leaving and rejoining left, onto the card whose stay still exists', () => {
    const fresh = beforeTheUniqueIndex()
    try {
      seed(fresh)

      runMigrations(fresh, migrationsFolder)

      expect(entriesOn(fresh, 't-bea-back')).toEqual(['x-bea-1@1', 'x-bea-2@2', 'x-bea-3@3', 'x-bea-4@4'])
      expect(fresh.client.prepare('select count(*) as n from thread where id = ?').get('t-bea-left')?.n).toBe(
        0,
      )
    } finally {
      fresh.close()
    }
  })

  it('refuses a second card for one person at one burn, which nothing but `cardFor` held before', () => {
    const fresh = beforeTheUniqueIndex()
    try {
      seed(fresh)

      runMigrations(fresh, migrationsFolder)

      expect(() =>
        fresh.client
          .prepare(
            'insert into thread (id, event_id, entity_type, entity_id, subject_account_id, title) values (?, ?, ?, ?, ?, ?)',
          )
          .run('t-cai-again', 'e-1', 'attendance', 'att-cai-2', 'a-cai', 'Cai'),
      ).toThrow(/UNIQUE/u)
    } finally {
      fresh.close()
    }
  })

  it('leaves every thread that is nobody’s in particular, however many there are', () => {
    const fresh = beforeTheUniqueIndex()
    try {
      seed(fresh)

      runMigrations(fresh, migrationsFolder)

      expect(subjectOf(fresh, 't-song')).toBeNull()
      expect(subjectOf(fresh, 't-other-song')).toBeNull()
      expect(subjectOf(fresh, 't-unknown')).toBeNull()
      expect(subjectOf(fresh, 't-unknown-too')).toBeNull()
      expect(entriesOn(fresh, 't-song')).toEqual(['x-song-1@1'])
    } finally {
      fresh.close()
    }
  })
})

describe('the song-link name nothing reads any more', () => {
  it('leaves each stored link its address and nothing else', () => {
    const fresh = createDb({ url: ':memory:' })
    const { staged, kept } = stagedThrough(SONG_LINK_URL_ONLY)

    try {
      expect(kept).not.toContain(SONG_LINK_URL_ONLY)
      runMigrations(fresh, staged)

      const aSong = fresh.client.prepare(
        'insert into song (id, title, body, links, created_at) values (?, ?, ?, ?, ?)',
      )
      aSong.run(
        's-named',
        'Ashes',
        '',
        JSON.stringify([
          { url: 'https://open.spotify.com/track/1', label: 'Spotify' },
          { url: 'https://youtu.be/2', label: '' },
        ]),
        NOW,
      )
      aSong.run('s-bare', 'Zephyr', '', '[]', NOW)

      runMigrations(fresh, migrationsFolder)

      const linksOf = (id: string) =>
        String(fresh.client.prepare('select links from song where id = ?').get(id)?.links)

      expect(JSON.parse(linksOf('s-named'))).toEqual([
        { url: 'https://open.spotify.com/track/1' },
        { url: 'https://youtu.be/2' },
      ])
      expect(JSON.parse(linksOf('s-bare'))).toEqual([])
    } finally {
      fresh.close()
    }
  })
})

describe('the cards a redeemed invite never opened', () => {
  const seed = (db: DbHandle) => {
    anEvent(db, 'e-1', 'a-burn', '2026-01-01T00:00:00Z')

    for (const [id, name] of [
      ['a-ada', 'Ada'],
      ['a-bea', 'Bea'],
      ['a-nameless', null],
    ] as [string, string | null][]) {
      db.client
        .prepare('insert into account (id, email, name, created_at) values (?, ?, ?, ?)')
        .run(id, `${id}@example.org`, name, NOW)
    }

    const aStay = db.client.prepare(
      'insert into attendance (id, event_id, account_id, joined_at) values (?, ?, ?, ?)',
    )
    aStay.run('att-ada', 'e-1', 'a-ada', '2026-07-01T10:00:00Z')
    aStay.run('att-bea', 'e-1', 'a-bea', '2026-07-02T10:00:00Z')
    aStay.run('att-nameless', 'e-1', 'a-nameless', '2026-07-03T10:00:00Z')

    db.client
      .prepare(
        'insert into thread (id, event_id, entity_type, entity_id, subject_account_id, title) values (?, ?, ?, ?, ?, ?)',
      )
      .run('t-bea', 'e-1', 'attendance', 'att-bea', 'a-bea', 'Bea')
    db.client
      .prepare(
        'insert into thread_entry (id, thread_id, kind, seq, author_account_id, body, created_at) values (?, ?, ?, ?, ?, ?, ?)',
      )
      .run('x-bea', 't-bea', 'joined', 1, 'a-bea', 'is coming', '2026-07-02T10:00:00Z')
  }

  const beforeTheBackfill = () => {
    const fresh = createDb({ url: ':memory:' })
    const { staged, kept } = stagedThrough(JOINED_CARDS)

    expect(kept).not.toContain(JOINED_CARDS)
    expect(kept.length).toBeGreaterThan(0)

    runMigrations(fresh, staged)

    return fresh
  }

  const cardFor = (db: DbHandle, accountId: string) =>
    db.client
      .prepare(
        `select thread.id as id, thread.entity_id as stay, thread.title as title,
                thread_entry.kind as kind, thread_entry.body as body,
                thread_entry.created_at as at, thread_entry.seq as seq
         from thread left join thread_entry on thread_entry.thread_id = thread.id
         where thread.entity_type = 'attendance' and thread.subject_account_id = ?`,
      )
      .all(accountId)

  it('opens one for a stay that has none, dated from the stay rather than from the deploy', () => {
    const fresh = beforeTheBackfill()
    try {
      seed(fresh)

      runMigrations(fresh, migrationsFolder)

      const [card, ...rest] = cardFor(fresh, 'a-ada')
      expect(rest).toEqual([])
      expect(card?.stay).toBe('att-ada')
      expect(card?.title).toBe('Ada')
      expect([card?.kind, card?.body, card?.at, card?.seq]).toEqual([
        'joined',
        'is coming',
        '2026-07-01T10:00:00Z',
        1,
      ])
    } finally {
      fresh.close()
    }
  })

  it('gives it an id of the shape everything else on the wire has', () => {
    const fresh = beforeTheBackfill()
    try {
      seed(fresh)

      runMigrations(fresh, migrationsFolder)

      expect(String(cardFor(fresh, 'a-ada')[0]?.id)).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      )
    } finally {
      fresh.close()
    }
  })

  it('leaves a card that already exists exactly as it was', () => {
    const fresh = beforeTheBackfill()
    try {
      seed(fresh)

      runMigrations(fresh, migrationsFolder)

      const held = cardFor(fresh, 'a-bea')
      expect(held).toHaveLength(1)
      expect(held[0]?.id).toBe('t-bea')
    } finally {
      fresh.close()
    }
  })

  it('opens one for somebody who never said what they are called', () => {
    const fresh = beforeTheBackfill()
    try {
      seed(fresh)

      runMigrations(fresh, migrationsFolder)

      expect(cardFor(fresh, 'a-nameless')[0]?.title).toBe('Somebody')
    } finally {
      fresh.close()
    }
  })
})
