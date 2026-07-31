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
  attendance,
  passkey,
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
      lodging: null,
      shift_preference: null,
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

  it('is idempotent — running again on the same database is a no-op', () => {
    expect(() => runMigrations(handle)).not.toThrow()
    expect(handle.db.select().from(event).all()).toHaveLength(1)
  })

  it('restores foreign key enforcement afterwards', () => {
    // It is switched off for the duration so a table-rebuild migration cannot
    // cascade-delete children. Leaving it off would be far worse than never
    // touching it.
    expect(handle.client.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1)
  })

  it('restores foreign key enforcement even when a migration throws', () => {
    expect(() => runMigrations(handle, '/nonexistent/migrations')).toThrow()
    expect(handle.client.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1)
  })

  it('refuses to migrate when foreign keys cannot be disabled', () => {
    // The load-bearing branch: the docblock says turning foreign keys off *is*
    // the whole protection against a table rebuild cascade-deleting children,
    // and `PRAGMA foreign_keys` is a silent no-op inside a transaction. Drop
    // the read-back and this file stays green while the cascade is re-armed.
    handle.client.exec('BEGIN')
    try {
      expect(() => runMigrations(handle)).toThrow(/disable foreign keys/i)
    } finally {
      handle.client.exec('ROLLBACK')
    }
  })

  it('refuses to finish if a migration left a dangling reference', () => {
    // Simulates what a table rebuild does with foreign keys off: the parent
    // goes, the children stay and point at nothing. Without the
    // foreign_key_check this commits silently and an organiser opens an empty
    // member list; with it, the boot fails instead.
    seedInvite(ids.invite)
    seedAttendance(ids.member, ids.account)

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
          id: ids.member,
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
    seedAttendance(ids.member, ids.account)
    handle.db
      .insert(session)
      .values({
        id: 's1',
        event_id: ids.event,
        title: 'Cacao ceremony',
        host_account_id: ids.account,
        description: 'Bring a cup.',
      })
      .run()

    handle.db.delete(event).where(eq(event.id, ids.event)).run()

    expect(handle.db.select().from(attendance).all()).toHaveLength(0)
    expect(handle.db.select().from(session).all()).toHaveLength(0)
  })

  it('leaves the questions and the applications alone, since neither belongs to an event', () => {
    // The inverse of the cascade above, and the reason both tables lost their
    // `event_id`: you apply to the community, not to a burn. Approval admits you
    // to any of them, so deleting last year's event must neither empty the form
    // nor destroy the applications people sent.
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
        applicant_contact: 'someone@example.org',
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
    seedAttendance(ids.member, ids.account)

    expect(() => seedAttendance(ids.otherMember, ids.account)).toThrow()
  })

  it('lets the same account be a member of a different event', () => {
    seedInvite(ids.invite)
    seedAttendance(ids.member, ids.account)

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
          id: ids.otherMember,
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
    // Without the partial unique index a double-clicked Approve mints two
    // invites for the same application, and single use is keyed on the token —
    // so each redeems into a separate account. One application, two humans.
    handle.db
      .insert(application)
      .values({
        id: 'app-dup',
        answers: [],
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
    // Enforced on `account` now that redemption creates the person rather than a
    // per-burn row. Without it a forwarded link lets a second person redeem the
    // same invite — and `member_cap` is sized against invites issued, so the cap
    // silently overruns too.
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
    // The index has to be partial: NULLs compare distinct in SQLite, but a
    // non-partial unique index would still collapse them on some engines, and
    // every bootstrap admin has none.
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
  const insertAttendance = (paymentStatus: string) =>
    handle.client
      .prepare(
        `INSERT INTO attendance (id, event_id, account_id, joined_at, payment_status)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(ids.member, ids.event, ids.account, NOW, paymentStatus)

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

  const insertStay = (arrival: string, departure: string) =>
    handle.client
      .prepare(
        `INSERT INTO attendance (id, event_id, account_id, joined_at, arrival_date, departure_date, payment_status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(ids.member, ids.event, ids.account, NOW, arrival, departure, 'unpaid')

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
          `INSERT INTO session (id, event_id, title, host_account_id, description, time_slot_start, time_slot_end)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('s-half', ids.event, 'Half a slot', ids.account, '', '2026-10-03T09:00:00Z', null),
    ).toThrow()
  })

  it('rejects a malformed date, which the ordering checks depend on', () => {
    // '2026-1-2' is not fixed width, so it sorts wrong — the ordering CHECKs
    // compare these as strings and would silently accept a backwards range.
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
    expect(() => seedAttendance(ids.member, ids.account)).not.toThrow()
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
    // The API refuses this too, but the constraint exists for writes that do not
    // come through it — and `required` has `.default(false)`, so an insert that
    // simply omits the column produces exactly the contradictory row. Both forms
    // here, since the second is the one the API cannot see.
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
    // The other half of the tick-box rule, and the API cannot see a direct insert.
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
    // So the constraint is "agreement implies required" rather than
    // "no agreements".
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
  const seedPasskey = (id: string, credential_id: string, counter = 0) =>
    handle.db
      .insert(passkey)
      .values({
        id,
        account_id: ids.account,
        credential_id,
        public_key: 'cHVibGljLWtleQ==',
        counter,
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
    expect(() =>
      handle.client
        .prepare(
          `INSERT INTO passkey (id, account_id, credential_id, public_key, counter, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run('pk-neg', ids.account, 'cred-neg', 'key', -1, NOW),
    ).toThrow()
  })

  it('goes away with the account it belongs to', () => {
    seedAccount(ids.otherAccount, 'someone.else@example.org')
    handle.db
      .insert(passkey)
      .values({
        id: 'pk1',
        account_id: ids.otherAccount,
        credential_id: 'cred-1',
        public_key: 'cHVibGljLWtleQ==',
        counter: 0,
        created_at: NOW,
      })
      .run()

    handle.db.delete(account).where(eq(account.id, ids.otherAccount)).run()

    expect(handle.db.select().from(passkey).all()).toHaveLength(0)
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
    seedAttendance(ids.member, ids.otherAccount)

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
            id: ids.member,
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
    seedAttendance(ids.member, ids.account)

    handle.db
      .insert(session)
      .values({
        id: 's2',
        event_id: ids.event,
        title: 'Something unplanned',
        host_account_id: ids.account,
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
    // The stored shape is the snapshot, not a bare map: the wording as asked
    // travels with the answer so it survives the question being edited or removed.
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
        applicant_contact: 'someone@example.org',
        submitted_at: NOW,
      })
      .run()

    expect(handle.db.select().from(application).all()[0]?.answers).toEqual(answers)
  })
})
