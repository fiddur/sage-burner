import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { DbHandle } from './client.ts'

import { createDb } from './client.ts'
import { runMigrations } from './migrate.ts'
import {
  account,
  accountRole,
  application,
  event,
  formQuestion,
  inviteToken,
  member,
  session,
} from './schema.ts'

/**
 * These run against a real SQLite database with the real migrations applied —
 * the constraints below are the point, and a mock would assert nothing.
 */

const ids = {
  account: 'a0000000-0000-4000-8000-000000000001',
  otherAccount: 'a0000000-0000-4000-8000-000000000002',
  event: 'e0000000-0000-4000-8000-000000000001',
  invite: 'i0000000-0000-4000-8000-000000000001',
  otherInvite: 'i0000000-0000-4000-8000-000000000002',
  member: 'm0000000-0000-4000-8000-000000000001',
  otherMember: 'm0000000-0000-4000-8000-000000000002',
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
      event_id: ids.event,
      application_id: null,
      expires_at: '2026-09-01T00:00:00Z',
      used_at: null,
      created_by: ids.account,
    })
    .run()

const seedMember = (id: string, account_id: string, invite_token_id: string) =>
  handle.db
    .insert(member)
    .values({
      id,
      event_id: ids.event,
      account_id,
      name: 'Someone',
      contact: 'someone@example.org',
      allergies_notes: null,
      arrival_date: null,
      departure_date: null,
      lodging: null,
      shift_preference: null,
      notes: null,
      payment_status: 'unpaid',
      payment_date: null,
      invite_token_id,
    })
    .run()

beforeEach(() => {
  handle = createDb({ url: ':memory:' })
  runMigrations(handle.db)
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
      'member',
      'passkey',
      'session',
    ]) {
      expect(names).toContain(table)
    }
  })

  it('is idempotent — running again on the same database is a no-op', () => {
    expect(() => runMigrations(handle.db)).not.toThrow()
    expect(handle.db.select().from(event).all()).toHaveLength(1)
  })
})

describe('foreign keys', () => {
  it('are actually enforced (SQLite defaults them off)', () => {
    const enabled = handle.client.prepare('PRAGMA foreign_keys').get()
    expect(enabled?.foreign_keys).toBe(1)
  })

  it('rejects a member pointing at an event that does not exist', () => {
    seedInvite(ids.invite)
    expect(() =>
      handle.db
        .insert(member)
        .values({
          id: ids.member,
          event_id: 'e0000000-0000-4000-8000-00000000dead',
          account_id: ids.account,
          name: 'Someone',
          contact: 'someone@example.org',
          payment_status: 'unpaid',
          invite_token_id: ids.invite,
        })
        .run(),
    ).toThrow()
  })

  it('cascades an event deletion to everything scoped to it', () => {
    seedInvite(ids.invite)
    seedMember(ids.member, ids.account, ids.invite)
    handle.db
      .insert(formQuestion)
      .values({ id: 'q1', event_id: ids.event, order: 0, type: 'text', label: 'Why?', required: true })
      .run()
    handle.db
      .insert(application)
      .values({
        id: 'app1',
        event_id: ids.event,
        answers: { q1: 'because' },
        status: 'pending',
        applicant_name: 'Someone',
        applicant_contact: 'someone@example.org',
        submitted_at: NOW,
      })
      .run()
    handle.db
      .insert(session)
      .values({
        id: 's1',
        event_id: ids.event,
        title: 'Cacao ceremony',
        host_member_id: ids.member,
        description: 'Bring a cup.',
      })
      .run()

    handle.db.delete(event).where(eq(event.id, ids.event)).run()

    expect(handle.db.select().from(formQuestion).all()).toHaveLength(0)
    expect(handle.db.select().from(application).all()).toHaveLength(0)
    expect(handle.db.select().from(member).all()).toHaveLength(0)
    expect(handle.db.select().from(session).all()).toHaveLength(0)
  })
})

describe('uniqueness', () => {
  it('allows only one membership per account per event', () => {
    seedInvite(ids.invite)
    seedInvite(ids.otherInvite)
    seedMember(ids.member, ids.account, ids.invite)

    expect(() => seedMember(ids.otherMember, ids.account, ids.otherInvite)).toThrow()
  })

  it('lets the same account be a member of a different event', () => {
    seedInvite(ids.invite)
    seedMember(ids.member, ids.account, ids.invite)

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
        event_id: 'e0000000-0000-4000-8000-000000000002',
        expires_at: '2026-12-01T00:00:00Z',
        created_by: ids.account,
      })
      .run()

    expect(() =>
      handle.db
        .insert(member)
        .values({
          id: ids.otherMember,
          event_id: 'e0000000-0000-4000-8000-000000000002',
          account_id: ids.account,
          name: 'Someone',
          contact: 'someone@example.org',
          payment_status: 'unpaid',
          invite_token_id: 'i0000000-0000-4000-8000-000000000003',
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
          event_id: ids.event,
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
    // Without the partial unique index a double-clicked Approve mints two
    // invites for the same application, and single use is keyed on the token —
    // so each redeems into a separate account. One application, two humans.
    handle.db
      .insert(application)
      .values({
        id: 'app-dup',
        event_id: ids.event,
        answers: {},
        status: 'approved',
        applicant_name: 'Someone',
        applicant_contact: 'someone@example.org',
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
          event_id: ids.event,
          application_id: 'app-dup',
          expires_at: '2026-09-01T00:00:00Z',
          created_by: ids.account,
        })
        .run()

    expect(() => mint('inv-1')).not.toThrow()
    expect(() => mint('inv-2')).toThrow()
  })

  it('still allows many direct admin invites, which carry no application', () => {
    // The index must be partial: NULLs compare distinct in SQLite, but a
    // non-partial unique index would still read as forbidding this.
    expect(() => seedInvite(ids.invite)).not.toThrow()
    expect(() => seedInvite(ids.otherInvite)).not.toThrow()
  })

  it('refuses a mixed-case email, so one human cannot become two accounts', () => {
    // SQLite's UNIQUE on TEXT is BINARY, so without the lowercase CHECK the
    // address below is simply a different account — with its own passkeys,
    // roles and memberships, able to join the very same event.
    expect(() => seedAccount(ids.otherAccount, 'Admin@Example.org')).toThrow()
    expect(() => seedAccount(ids.otherAccount, 'someone.else@example.org')).not.toThrow()
  })

  it('makes an invite genuinely single-use, even by a different account', () => {
    // The (event, account) index only stops the *same* person joining twice.
    // Without a unique index on invite_token_id, a forwarded invite link lets
    // a second person redeem it — and member_cap is sized against invites
    // issued, so the cap silently overruns too.
    seedAccount(ids.otherAccount, 'someone.else@example.org')
    seedInvite(ids.invite)
    seedMember(ids.member, ids.account, ids.invite)

    expect(() => seedMember(ids.otherMember, ids.otherAccount, ids.invite)).toThrow()
  })

  it('rejects a NULL primary key, which SQLite would otherwise allow', () => {
    // Outside INTEGER PRIMARY KEY, SQLite permits NULL in a primary key column
    // unless it is also NOT NULL — and NULLs compare distinct, so it permits
    // several. Drizzle's types require an id, but a raw statement does not.
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
  it('rejects a payment status outside the shared vocabulary', () => {
    seedInvite(ids.invite)
    expect(() =>
      handle.client
        .prepare(
          `INSERT INTO member (id, event_id, account_id, name, contact, payment_status, invite_token_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(ids.member, ids.event, ids.account, 'Someone', 'a@b.c', 'refunded', ids.invite),
    ).toThrow()
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
          `INSERT INTO application (id, event_id, answers, status, applicant_name, applicant_contact, submitted_at)
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

  it('rejects a member departing before they arrive', () => {
    seedInvite(ids.invite)
    expect(() =>
      handle.client
        .prepare(
          `INSERT INTO member (id, event_id, account_id, name, contact, arrival_date, departure_date,
                               payment_status, invite_token_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          ids.member,
          ids.event,
          ids.account,
          'Someone',
          'a@b.c',
          '2026-10-04',
          '2026-10-02',
          'unpaid',
          ids.invite,
        ),
    ).toThrow()
  })

  it('rejects half a time slot', () => {
    seedInvite(ids.invite)
    seedMember(ids.member, ids.account, ids.invite)
    expect(() =>
      handle.client
        .prepare(
          `INSERT INTO session (id, event_id, title, host_member_id, description, time_slot_start, time_slot_end)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('s-half', ids.event, 'Half a slot', ids.member, '', '2026-10-03T09:00:00Z', null),
    ).toThrow()
  })

  it('rejects a negative question order', () => {
    expect(() =>
      handle.client
        .prepare(
          'INSERT INTO form_question (id, event_id, "order", type, label, required) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run('q-neg', ids.event, -1, 'text', 'Why?', 1),
    ).toThrow()
  })

  it('rejects a non-boolean required flag, which SQLite would otherwise store', () => {
    expect(() =>
      handle.client
        .prepare(
          'INSERT INTO form_question (id, event_id, "order", type, label, required) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run('q-seven', ids.event, 0, 'text', 'Why?', 7),
    ).toThrow()
  })

  it('rejects a question type the form cannot render', () => {
    expect(() =>
      handle.client
        .prepare(
          'INSERT INTO form_question (id, event_id, "order", type, label, required) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run('q2', ids.event, 0, 'select', 'Pick one', 1),
    ).toThrow()
  })
})

describe('transactions', () => {
  it('rolls back every write when the body throws', () => {
    seedInvite(ids.invite)

    expect(() =>
      handle.db.transaction((tx) => {
        tx.insert(member)
          .values({
            id: ids.member,
            event_id: ids.event,
            account_id: ids.account,
            name: 'Someone',
            contact: 'someone@example.org',
            payment_status: 'unpaid',
            invite_token_id: ids.invite,
          })
          .run()
        throw new Error('redemption failed halfway')
      }),
    ).toThrow('redemption failed halfway')

    expect(handle.db.select().from(member).all()).toHaveLength(0)
  })
})

describe('sessions', () => {
  it('accepts an unscheduled dream — the normal state before the burn', () => {
    seedInvite(ids.invite)
    seedMember(ids.member, ids.account, ids.invite)

    handle.db
      .insert(session)
      .values({
        id: 's2',
        event_id: ids.event,
        title: 'Something unplanned',
        host_member_id: ids.member,
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
    const answers = { 'q-1': 'a written answer', 'q-2': true }
    handle.db
      .insert(application)
      .values({
        id: 'app3',
        event_id: ids.event,
        answers,
        status: 'pending',
        applicant_name: 'Someone',
        applicant_contact: 'someone@example.org',
        submitted_at: NOW,
      })
      .run()

    expect(handle.db.select().from(application).all()[0]?.answers).toEqual(answers)
  })
})
