import type { FastifyInstance, LightMyRequestResponse } from 'fastify'

import { MAX_INTRODUCTION } from '@sage-burner/shared'
import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { SESSION_COOKIE } from '../auth/viewer.ts'
import { createConfig } from '../config.ts'
import { isForeignKeyViolation } from '../db/errors.ts'
import { createDb, runMigrations } from '../db/index.ts'
import {
  account,
  accountRole,
  attendance,
  attendanceHelping,
  event,
  eventOption,
  image,
  thread,
  threadEntry,
} from '../db/schema.ts'
import { writeAllergyTicks } from './allergy-ticks.ts'
import { helpingIdsFor, writeHelping } from './helping.ts'
import { writeStay } from './profile.ts'

/**
 * A member maintaining their own record.
 *
 * The acceptance criterion is authorization: whose row gets written is derived
 * from the session and never from the request, so there is no id to guess. These
 * tests try to guess one anyway.
 */

const SECRET = 's'.repeat(40)
const NOW = '2026-07-02T00:00:00.000Z'

let handle: DbHandle | undefined
let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  handle?.close()
  app = undefined
  handle = undefined
})

const build = async () => {
  handle = createDb({ url: ':memory:' })
  runMigrations(handle)
  app = await createApp({
    db: handle.db,
    config: createConfig({ LOG_LEVEL: 'silent', SESSION_SECRET: SECRET }),
    now: () => new Date(NOW),
  })
  return app
}

const client = () => {
  const found = handle?.client
  if (found === undefined) throw new Error('build() first')
  return found
}

const db = () => {
  const found = handle?.db
  if (found === undefined) throw new Error('build() first')
  return found
}

const givenMember = async (over: { name?: string; roles?: ('admin' | 'member')[] } = {}) => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({
      id,
      email: `${id}@example.org`,
      password_hash: null,
      name: over.name ?? 'Someone',
      contact: 'someone@example.org',
      allergies_notes: null,
      created_at: NOW,
    })
  for (const role of over.roles ?? ['member']) {
    await db().insert(accountRole).values({ account_id: id, role })
  }

  const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })
  return { id, cookie: `${SESSION_COOKIE}=${sessions.issue(id)}` }
}

const givenEvent = async (over: { start_date?: string; end_date?: string; slug?: string } = {}) => {
  const id = randomUUID()
  await db()
    .insert(event)
    .values({
      id,
      name: 'Summer burn',
      slug: over.slug ?? `burn-${id.slice(0, 8)}`,
      start_date: over.start_date ?? '2026-08-01',
      end_date: over.end_date ?? '2026-08-05',
      member_cap: 42,
      created_at: NOW,
    })
  return id
}

const givenComing = async (eventId: string, accountId: string) => {
  const id = randomUUID()
  await db()
    .insert(attendance)
    .values({ id, event_id: eventId, account_id: accountId, joined_at: NOW, payment_status: 'unpaid' })
  return id
}

const getProfile = (server: FastifyInstance, cookie: string) =>
  server.inject({ method: 'GET', url: '/api/me/profile', headers: { cookie } })

const bell = async (server: FastifyInstance, cookie: string): Promise<{ body: string }[]> =>
  (await server.inject({ method: 'GET', url: '/api/me/notifications', headers: { cookie } })).json()
    .notifications

const listenFor = (server: FastifyInstance, cookie: string, on: string[]) =>
  server.inject({
    method: 'PUT',
    url: '/api/me/notification-settings',
    headers: { cookie },
    payload: { on, email: [], digest: 'daily' },
  })

const patchProfile = (
  server: FastifyInstance,
  cookie: string,
  payload: Record<string, unknown>,
): Promise<LightMyRequestResponse> =>
  server.inject({ method: 'PATCH', url: '/api/me/profile', headers: { cookie }, payload })

const patchStay = (
  server: FastifyInstance,
  cookie: string,
  eventId: string,
  payload: Record<string, unknown>,
): Promise<LightMyRequestResponse> =>
  server.inject({
    method: 'PATCH',
    url: `/api/events/${eventId}/attendance/me`,
    headers: { cookie },
    payload,
  })

describe('a member reading and editing who they are', () => {
  it('reads back their own details', async () => {
    const server = await build()
    const member = await givenMember()

    const response = await getProfile(server, member.cookie)

    expect(response.statusCode).toBe(200)
    expect(response.json().profile.name).toBe('Someone')
    expect(response.json().profile.account_id).toBe(member.id)
  })

  it('changes one field without clearing the others', async () => {
    const server = await build()
    const member = await givenMember()

    const response = await patchProfile(server, member.cookie, { allergies_notes: 'peanuts' })

    expect(response.statusCode).toBe(200)
    expect(response.json().profile.allergies_notes).toBe('peanuts')
    expect(response.json().profile.contact).toBe('someone@example.org')
  })

  it('keeps an introduction, and clears it for an empty one', async () => {
    // #390. `optionalText` turns empty into null on the way in, so "I wrote nothing" and "I
    // took it down" are the same stored state — which is what the page reads to decide
    // whether to invite somebody to write one.
    const server = await build()
    const member = await givenMember()

    const written = await patchProfile(server, member.cookie, {
      introduction: 'I make **fire**, and I have been coming since the first one.',
    })
    expect(written.json().profile.introduction).toContain('I make **fire**')

    const cleared = await patchProfile(server, member.cookie, { introduction: '' })
    expect(cleared.json().profile.introduction).toBeNull()
  })

  it('goes with the account, and takes the pictures written into it too', async () => {
    // #390's erasure note, asserted rather than assumed — and the picture is written for
    // real, or this would only prove that deleting a row deletes it. `image.uploaded_by`
    // is what carries the cascade; the column needs none of its own.
    const server = await build()
    const member = await givenMember()
    const pictureId = randomUUID()
    await db()
      .insert(image)
      .values({
        id: pictureId,
        bytes: Buffer.from([1, 2, 3]),
        content_type: 'image/png',
        uploaded_by: member.id,
        created_at: NOW,
      })
    await patchProfile(server, member.cookie, {
      introduction: `I make fire.\n\n![](/api/images/${pictureId})`,
    })

    await db().delete(account).where(eq(account.id, member.id))

    expect(await db().select().from(account).where(eq(account.id, member.id))).toEqual([])
    expect(await db().select().from(image).where(eq(image.id, pictureId))).toEqual([])
  })

  it('refuses one longer than the field takes, rather than storing a truncation', async () => {
    const server = await build()
    const member = await givenMember()

    const refused = await patchProfile(server, member.cookie, {
      introduction: 'a'.repeat(MAX_INTRODUCTION + 1),
    })

    expect(refused.statusCode).toBe(400)
    // The passing sibling: exactly the limit is fine, so the bound is not off by one.
    const accepted = await patchProfile(server, member.cookie, {
      introduction: 'a'.repeat(MAX_INTRODUCTION),
    })
    expect(accepted.statusCode).toBe(200)
  })

  it('never touches anyone else, whatever the body says', async () => {
    // The acceptance criterion. There is no id in the body to aim at, and adding
    // one is a 400 rather than a redirect of the write.
    const server = await build()
    const member = await givenMember()
    const other = await givenMember({ name: 'Someone Else' })

    const response = await patchProfile(server, member.cookie, {
      name: 'Changed',
      account_id: other.id,
    })

    expect(response.statusCode).toBe(400)
    const [row] = await db().select().from(account).where(eq(account.id, other.id))
    expect(row?.name).toBe('Someone Else')
  })

  it('refuses to set an empty name, since an admin has to reach them', async () => {
    const server = await build()
    const member = await givenMember()

    expect((await patchProfile(server, member.cookie, { name: '   ' })).statusCode).toBe(400)
    expect((await patchProfile(server, member.cookie, { contact: '' })).statusCode).toBe(400)
  })

  it('treats an empty body as a no-op rather than a 500', async () => {
    // `set({})` is not valid SQL.
    const server = await build()
    const member = await givenMember()

    const response = await patchProfile(server, member.cookie, {})

    expect(response.statusCode).toBe(200)
    expect(response.json().profile.name).toBe('Someone')
  })

  it('refuses to change the login email here', async () => {
    // Changing the identity you sign in with is a different act, with
    // verification nothing implements yet.
    const server = await build()
    const member = await givenMember()

    expect((await patchProfile(server, member.cookie, { email: 'new@example.org' })).statusCode).toBe(400)
  })

  it('refuses an anonymous caller', async () => {
    const server = await build()

    expect((await server.inject({ method: 'GET', url: '/api/me/profile' })).statusCode).toBe(401)
    expect(
      (await server.inject({ method: 'PATCH', url: '/api/me/profile', payload: { name: 'x' } })).statusCode,
    ).toBe(401)
  })

  it('answers an organiser who is not attending, whose record this also is', async () => {
    // `requireApproved` since #412. A name, a picture and an introduction belong to the
    // account rather than to a stay — and their own page invites them to write one, which
    // `requireMember` here made a dead end.
    const server = await build()
    const boss = await givenMember({ roles: ['admin'] })

    expect((await getProfile(server, boss.cookie)).statusCode).toBe(200)
    expect((await patchProfile(server, boss.cookie, { introduction: 'I organise.' })).statusCode).toBe(200)
  })

  it('refuses an account with no role at all', async () => {
    // The passing sibling for the guard: `approved` is not "signed in", and an applicant
    // waiting on a decision has no record here to keep.
    const server = await build()
    const nobody = await givenMember({ roles: [] })

    expect((await getProfile(server, nobody.cookie)).statusCode).toBe(403)
    expect((await patchProfile(server, nobody.cookie, { name: 'Nope' })).statusCode).toBe(403)
  })
})

describe('a member editing their stay', () => {
  it('saves the details for the burn they are coming to', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenMember()
    await givenComing(eventId, member.id)

    const response = await patchStay(server, member.cookie, eventId, {
      arrival_date: '2026-08-01',
      departure_date: '2026-08-05',
      lodging_option_id: null,
      helping_other: 'Sauna tending',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().attendance.helping_other).toBe('Sauna tending')
    expect(response.json().attendance.arrival_date).toBe('2026-08-01')
  })

  it('refuses a departure before the arrival', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenMember()
    await givenComing(eventId, member.id)

    const response = await patchStay(server, member.cookie, eventId, {
      arrival_date: '2026-08-05',
      departure_date: '2026-08-01',
    })

    expect(response.statusCode).toBe(400)
  })

  it('refuses a single date that inverts the stored pair', async () => {
    // The case the schema cannot see: the body carries one date, and the conflict
    // is only visible against the row. Composed into the WHERE rather than
    // compared after a read, so a concurrent write cannot slip between.
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenMember()
    await givenComing(eventId, member.id)
    await patchStay(server, member.cookie, eventId, {
      arrival_date: '2026-08-01',
      departure_date: '2026-08-03',
    })

    const response = await patchStay(server, member.cookie, eventId, { departure_date: '2026-07-30' })

    expect(response.statusCode).toBe(400)
    const [row] = await db().select().from(attendance)
    expect(row?.departure_date).toBe('2026-08-03')
  })

  it('accepts a single date that does not invert it', async () => {
    // The passing sibling: the condition must not refuse an ordinary edit.
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenMember()
    await givenComing(eventId, member.id)
    await patchStay(server, member.cookie, eventId, {
      arrival_date: '2026-08-01',
      departure_date: '2026-08-03',
    })

    const response = await patchStay(server, member.cookie, eventId, { departure_date: '2026-08-04' })

    expect(response.statusCode).toBe(200)
    expect(response.json().attendance.departure_date).toBe('2026-08-04')
  })

  it('lets a date be cleared', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenMember()
    await givenComing(eventId, member.id)
    await patchStay(server, member.cookie, eventId, {
      arrival_date: '2026-08-01',
      departure_date: '2026-08-03',
    })

    const response = await patchStay(server, member.cookie, eventId, { departure_date: null })

    expect(response.statusCode).toBe(200)
    expect(response.json().attendance.departure_date).toBeNull()
  })

  it('refuses to let a member mark themselves paid', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenMember()
    await givenComing(eventId, member.id)

    const response = await patchStay(server, member.cookie, eventId, { payment_status: 'paid' })

    expect(response.statusCode).toBe(400)
    const [row] = await db().select().from(attendance)
    expect(row?.payment_status).toBe('unpaid')
  })

  it('never touches another member’s stay', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenMember()
    const other = await givenMember()
    await givenComing(eventId, member.id)
    const otherRow = await givenComing(eventId, other.id)

    await patchStay(server, member.cookie, eventId, { notes: 'Mine' })

    const [row] = await db().select().from(attendance).where(eq(attendance.id, otherRow))
    expect(row?.notes).toBeNull()
  })

  it('answers 404 when they are not coming to this burn', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenMember()

    expect((await patchStay(server, member.cookie, eventId, { notes: 'Tent' })).statusCode).toBe(404)
  })

  it('answers 404 for a burn that has ended, and for one that never existed', async () => {
    // A stay at a finished burn is the record of it, not a form. Both get the same
    // answer, so that an id cannot be probed for existence.
    const server = await build()
    const gone = await givenEvent({ start_date: '2025-08-01', end_date: '2025-08-05', slug: 'gone' })
    const member = await givenMember()
    await givenComing(gone, member.id)

    expect((await patchStay(server, member.cookie, gone, { notes: 'Tent' })).statusCode).toBe(404)
    expect((await patchStay(server, member.cookie, randomUUID(), { notes: 'x' })).statusCode).toBe(404)
    const [row] = await db().select().from(attendance)
    expect(row?.notes).toBeNull()
  })

  it('refuses an anonymous caller', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenMember()
    await givenComing(eventId, member.id)

    const response = await server.inject({
      method: 'PATCH',
      url: `/api/events/${eventId}/attendance/me`,
      payload: { notes: 'Tent' },
    })

    expect(response.statusCode).toBe(401)
    const [row] = await db().select().from(attendance)
    expect(row?.notes).toBeNull()
  })
})

describe('picking somewhere to sleep', () => {
  const givenOption = async (eventId: string, label: string, capacity: number | null) => {
    const id = randomUUID()
    await db()
      .insert(eventOption)
      .values({ id, event_id: eventId, kind: 'lodging', order: 0, label, capacity })
    return id
  }

  const pick = (server: FastifyInstance, cookie: string, eventId: string, optionId: string | null) =>
    server.inject({
      method: 'PATCH',
      url: `/api/events/${eventId}/attendance/me`,
      headers: { cookie },
      payload: { lodging_option_id: optionId },
    })

  it('records the option they picked', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenMember()
    await givenComing(eventId, member.id)
    const temple = await givenOption(eventId, 'Temple mattress', 9)

    const response = await pick(server, member.cookie, eventId, temple)

    expect(response.statusCode).toBe(200)
    expect(response.json().attendance.lodging_option_id).toBe(temple)
  })

  it('refuses one that is already full', async () => {
    // A disabled `<option>` is presentation; the API takes what it is sent.
    const server = await build()
    const eventId = await givenEvent()
    const first = await givenMember()
    const second = await givenMember()
    await givenComing(eventId, first.id)
    await givenComing(eventId, second.id)
    const bed = await givenOption(eventId, 'The one bed', 1)
    await pick(server, first.cookie, eventId, bed)

    const response = await pick(server, second.cookie, eventId, bed)

    expect(response.statusCode).toBe(409)
    // The code and the slug travel together; a 409 carrying `bad_request` would
    // tell a client one thing in the status and another in the body.
    expect(response.json()).toEqual({ error: 'conflict' })
    const [row] = await db().select().from(attendance).where(eq(attendance.account_id, second.id))
    expect(row?.lodging_option_id).toBeNull()
  })

  it('lets someone re-save the option they are already in', async () => {
    // Their own choice must not count against them, or editing an unrelated
    // field would refuse the bed they are already sleeping in.
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenMember()
    await givenComing(eventId, member.id)
    const bed = await givenOption(eventId, 'The one bed', 1)
    await pick(server, member.cookie, eventId, bed)

    expect((await pick(server, member.cookie, eventId, bed)).statusCode).toBe(200)
  })

  it('lets as many in as like when there is no limit', async () => {
    // The passing sibling: the check must refuse a full option, not every option.
    const server = await build()
    const eventId = await givenEvent()
    const first = await givenMember()
    const second = await givenMember()
    await givenComing(eventId, first.id)
    await givenComing(eventId, second.id)
    const tent = await givenOption(eventId, 'Own tent', null)
    await pick(server, first.cookie, eventId, tent)

    expect((await pick(server, second.cookie, eventId, tent)).statusCode).toBe(200)
  })

  it('lets them take it back to not decided', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenMember()
    await givenComing(eventId, member.id)
    const bed = await givenOption(eventId, 'The one bed', 1)
    await pick(server, member.cookie, eventId, bed)

    const response = await pick(server, member.cookie, eventId, null)

    expect(response.statusCode).toBe(200)
    expect(response.json().attendance.lodging_option_id).toBeNull()
  })

  it('refuses an option belonging to another burn', async () => {
    // The select cannot offer it, but the API takes what it is sent. Without the
    // event filter the id resolves, has no capacity for this burn, and is quietly
    // accepted.
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenMember()
    await givenComing(eventId, member.id)

    const elsewhere = randomUUID()
    await db()
      .insert(event)
      .values({
        id: elsewhere,
        name: 'Another burn',
        slug: `other-${elsewhere.slice(0, 8)}`,
        start_date: '2027-08-01',
        end_date: '2027-08-05',
        member_cap: 42,
        created_at: NOW,
      })
    const theirs = await givenOption(elsewhere, 'Their temple', 9)

    expect((await pick(server, member.cookie, eventId, theirs)).statusCode).toBe(400)
  })

  it('refuses a helping option, which has no capacity to be full of', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenMember()
    await givenComing(eventId, member.id)

    const id = randomUUID()
    await db()
      .insert(eventOption)
      .values({ id, event_id: eventId, kind: 'helping', order: 0, label: 'Sauna', capacity: null })

    expect((await pick(server, member.cookie, eventId, id)).statusCode).toBe(400)
  })

  it('refuses an option that is not a real one', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenMember()
    await givenComing(eventId, member.id)

    const response = await pick(server, member.cookie, eventId, randomUUID())

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'bad_request' })
  })
})

describe('what someone will help with', () => {
  const givenHelping = async (eventId: string, label: string) => {
    const id = randomUUID()
    await db()
      .insert(eventOption)
      .values({ id, event_id: eventId, kind: 'helping', order: 0, label, capacity: null })
    return id
  }

  const tick = (server: FastifyInstance, cookie: string, eventId: string, ids: string[]) =>
    server.inject({
      method: 'PATCH',
      url: `/api/events/${eventId}/attendance/me`,
      headers: { cookie },
      payload: { helping_option_ids: ids },
    })

  it('records several at once, because people help with more than one thing', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenMember()
    await givenComing(eventId, member.id)
    const sauna = await givenHelping(eventId, 'Sauna')
    const kitchen = await givenHelping(eventId, 'Kitchen')

    const response = await tick(server, member.cookie, eventId, [sauna, kitchen])

    expect(response.statusCode).toBe(200)
    expect([...response.json().attendance.helping_option_ids].sort()).toEqual([sauna, kitchen].sort())
  })

  it('replaces the set rather than adding to it', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenMember()
    await givenComing(eventId, member.id)
    const sauna = await givenHelping(eventId, 'Sauna')
    const kitchen = await givenHelping(eventId, 'Kitchen')
    await tick(server, member.cookie, eventId, [sauna, kitchen])

    const response = await tick(server, member.cookie, eventId, [kitchen])

    expect(response.json().attendance.helping_option_ids).toEqual([kitchen])
  })

  it('takes them all back off', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenMember()
    await givenComing(eventId, member.id)
    const sauna = await givenHelping(eventId, 'Sauna')
    await tick(server, member.cookie, eventId, [sauna])

    expect((await tick(server, member.cookie, eventId, [])).json().attendance.helping_option_ids).toEqual([])
  })

  it('refuses a lodging option ticked as a thing to help with', async () => {
    // The checkboxes only offer the helping list, but the API takes what it is
    // sent — and a bed is not a chore.
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenMember()
    await givenComing(eventId, member.id)
    const bed = randomUUID()
    await db()
      .insert(eventOption)
      .values({ id: bed, event_id: eventId, kind: 'lodging', order: 0, label: 'Temple', capacity: 9 })

    expect((await tick(server, member.cookie, eventId, [bed])).statusCode).toBe(400)
  })

  it('refuses another burn\u2019s helping option', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenMember()
    await givenComing(eventId, member.id)

    const elsewhere = randomUUID()
    await db()
      .insert(event)
      .values({
        id: elsewhere,
        name: 'Another burn',
        slug: `other-${elsewhere.slice(0, 8)}`,
        start_date: '2027-08-01',
        end_date: '2027-08-05',
        member_cap: 42,
        created_at: NOW,
      })
    const theirs = await givenHelping(elsewhere, 'Their sauna')

    expect((await tick(server, member.cookie, eventId, [theirs])).statusCode).toBe(400)
  })

  it('writes nothing at all when a tick is refused', async () => {
    // The form sends the columns and the ticks in one PATCH. Validating the ticks
    // after the column update answers 400 with the notes already saved.
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenMember()
    await givenComing(eventId, member.id)

    const response = await server.inject({
      method: 'PATCH',
      url: `/api/events/${eventId}/attendance/me`,
      headers: { cookie: member.cookie },
      payload: { notes: 'Should not be saved', helping_option_ids: [randomUUID()] },
    })

    expect(response.statusCode).toBe(400)
    const [row] = await db().select().from(attendance).where(eq(attendance.account_id, member.id))
    expect(row?.notes).toBeNull()
  })

  it('keeps a write-in beside the ticks', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenMember()
    await givenComing(eventId, member.id)
    const sauna = await givenHelping(eventId, 'Sauna')

    const response = await server.inject({
      method: 'PATCH',
      url: `/api/events/${eventId}/attendance/me`,
      headers: { cookie: member.cookie },
      payload: { helping_option_ids: [sauna], helping_other: 'Chopping wood' },
    })

    expect(response.json().attendance.helping_option_ids).toEqual([sauna])
    expect(response.json().attendance.helping_other).toBe('Chopping wood')
  })

  it('lets an admin remove an option someone ticked, unlike a bed', async () => {
    // Nobody is displaced by "kitchen" ceasing to be offered, so this cascades
    // where lodging refuses.
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenMember()
    await givenComing(eventId, member.id)
    const sauna = await givenHelping(eventId, 'Sauna')
    await tick(server, member.cookie, eventId, [sauna])

    client().prepare('delete from event_option where id = ?').run(sauna)

    const after = await server.inject({
      method: 'GET',
      url: '/api/events/mine',
      headers: { cookie: member.cookie },
    })
    expect(after.json().coming[0].attendance.helping_option_ids).toEqual([])
  })
})

describe('a helping option that vanishes mid-save', () => {
  // The window `stayProblem` cannot close: an admin deletes a chore between
  // the pre-check and the write. `inject` serialises requests, so the HTTP route
  // cannot open it — `writeStay` is exported and driven directly instead, which
  // is the same code the route runs.
  const givenSauna = async (eventId: string) => {
    const id = randomUUID()
    await db()
      .insert(eventOption)
      .values({ id, event_id: eventId, kind: 'helping', order: 0, label: 'Sauna', capacity: null })
    return id
  }

  const stayOf = (eventId: string, accountId: string) => {
    // `and` is typed `SQL | undefined` however many conditions it is given, and
    // `writeStay` takes a definite one — an unfiltered `UPDATE` on `attendance` is
    // exactly what its own guard refuses.
    const where = and(eq(attendance.event_id, eventId), eq(attendance.account_id, accountId))
    if (where === undefined) throw new Error('unreachable: two conditions')

    return where
  }

  it('takes the column write down with it, rather than half-saving the stay', async () => {
    await build()
    const eventId = await givenEvent()
    const member = await givenMember()
    const stay = await givenComing(eventId, member.id)
    await db().update(attendance).set({ notes: 'before' }).where(eq(attendance.id, stay))

    const sauna = await givenSauna(eventId)
    client().prepare('delete from event_option where id = ?').run(sauna)

    const thrown = (() => {
      try {
        writeStay(db(), stayOf(eventId, member.id), { notes: 'after' }, [sauna])
        return undefined
      } catch (failure) {
        return failure
      }
    })()

    // The route answers 400 on exactly this predicate, so asserting it is what
    // ties the rollback to the answer the member gets.
    expect(isForeignKeyViolation(thrown)).toBe(true)

    const [row] = await db().select().from(attendance).where(eq(attendance.id, stay))
    expect(row?.notes).toBe('before')
    expect(await helpingIdsFor(db(), stay)).toEqual([])
  })

  it('writes both halves when the option is still there', async () => {
    // The passing sibling: the rollback must mean the option vanished, not that
    // saving columns and ticks together fails generally.
    await build()
    const eventId = await givenEvent()
    const member = await givenMember()
    const stay = await givenComing(eventId, member.id)

    const sauna = await givenSauna(eventId)
    writeStay(db(), stayOf(eventId, member.id), { notes: 'after' }, [sauna])

    const [row] = await db().select().from(attendance).where(eq(attendance.id, stay))
    expect(row?.notes).toBe('after')
    expect(await helpingIdsFor(db(), stay)).toEqual([sauna])
  })

  it('takes the ticks with the stay when someone withdraws', async () => {
    // The other side of the cascade. The option side is covered in
    // `roster.test.ts`; nothing covered this one.
    await build()
    const eventId = await givenEvent()
    const member = await givenMember()
    const stay = await givenComing(eventId, member.id)

    const sauna = await givenSauna(eventId)
    writeHelping(db(), stay, [sauna])

    client().prepare('delete from attendance where id = ?').run(stay)

    expect(await db().select().from(attendanceHelping)).toEqual([])
  })
})

describe('the allergy ticks on a profile', () => {
  const LACTOSE = 'a11e0000-0000-4000-8000-000000000004'
  const VEGAN = 'a11e0000-0000-4000-8000-000000000001'

  it('comes back empty for somebody who has ticked nothing', async () => {
    const server = await build()
    const ada = await givenMember()

    expect((await getProfile(server, ada.cookie)).json().profile.allergy_item_ids).toEqual([])
  })

  it('saves the ticks and reads them back', async () => {
    const server = await build()
    const ada = await givenMember()

    const saved = await patchProfile(server, ada.cookie, { allergy_item_ids: [LACTOSE, VEGAN] })

    expect(saved.statusCode).toBe(200)
    expect([...saved.json().profile.allergy_item_ids].toSorted()).toEqual([VEGAN, LACTOSE].toSorted())
  })

  it('replaces the whole set rather than adding to it', async () => {
    // The form sends every box it is showing, so a delta would need the client to
    // know what it had before in order to say what changed.
    const server = await build()
    const ada = await givenMember()
    await patchProfile(server, ada.cookie, { allergy_item_ids: [LACTOSE, VEGAN] })

    const saved = await patchProfile(server, ada.cookie, { allergy_item_ids: [VEGAN] })

    expect(saved.json().profile.allergy_item_ids).toEqual([VEGAN])
  })

  it('leaves the ticks alone when the body does not mention them', async () => {
    // The passing sibling: treating an absent field as an empty set would wipe
    // somebody's allergies every time they fixed a typo in their name.
    const server = await build()
    const ada = await givenMember()
    await patchProfile(server, ada.cookie, { allergy_item_ids: [LACTOSE] })

    const saved = await patchProfile(server, ada.cookie, { name: 'Ada Lovelace' })

    expect(saved.json().profile.allergy_item_ids).toEqual([LACTOSE])
  })

  it('refuses an id that is not an allergy item, and saves nothing at all', async () => {
    // Asked before the columns are written: the form sends both in one PATCH, so a
    // late refusal would answer 400 over a name that did change.
    const server = await build()
    const ada = await givenMember({ name: 'Ada' })

    const refused = await patchProfile(server, ada.cookie, {
      name: 'Someone Else',
      allergy_item_ids: [randomUUID()],
    })

    expect(refused.statusCode).toBe(400)
    expect((await getProfile(server, ada.cookie)).json().profile.name).toBe('Ada')
  })

  it('keeps one person’s ticks off another’s profile', async () => {
    const server = await build()
    const ada = await givenMember()
    const bea = await givenMember()
    await patchProfile(server, ada.cookie, { allergy_item_ids: [LACTOSE] })

    expect((await getProfile(server, bea.cookie)).json().profile.allergy_item_ids).toEqual([])
  })
})

describe('an allergy item deleted while somebody is saving', () => {
  it('is a foreign key violation, which is why the write needs catching', () => {
    // The window the pre-check cannot close: an admin removes the item between
    // the request arrives and the write. This is what reaches the route when that
    // happens — `updateMyStay` answers 400 for the identical race.
    return build().then(async () => {
      const ada = await givenMember()

      expect(() =>
        db().transaction((tx) => {
          writeAllergyTicks(tx, ada.id, [randomUUID()])
        }),
      ).toThrowError(/FOREIGN KEY/i)
    })
  })

  it('rolls the name back when the ticks are refused', async () => {
    // Both halves are one transaction, so neither survives being told no — which is
    // also why catching the violation and answering 400 saves nothing either.
    const server = await build()
    const ada = await givenMember({ name: 'Ada' })

    const answer = await patchProfile(server, ada.cookie, {
      name: 'Someone Else',
      allergy_item_ids: [randomUUID()],
    })

    expect(answer.statusCode).toBe(400)
    expect((await getProfile(server, ada.cookie)).json().profile.name).toBe('Ada')
  })
})

describe('an introduction on the burns somebody is coming to', () => {
  const cardsFor = async (accountId: string) =>
    await db()
      .select({
        thread_id: thread.id,
        event_id: thread.event_id,
        title: thread.title,
        kind: threadEntry.kind,
        body: threadEntry.body,
        author: threadEntry.author_account_id,
      })
      .from(thread)
      .innerJoin(attendance, eq(attendance.id, thread.entity_id))
      .leftJoin(threadEntry, eq(threadEntry.thread_id, thread.id))
      .where(and(eq(thread.entity_type, 'attendance'), eq(attendance.account_id, accountId)))

  it('says who they are on the card of every burn still to come', async () => {
    const server = await build()
    const member = await givenMember({ name: 'Ada' })
    const summer = await givenEvent({ slug: 'summer' })
    const autumn = await givenEvent({ slug: 'autumn', start_date: '2026-09-01', end_date: '2026-09-05' })
    await givenComing(summer, member.id)
    await givenComing(autumn, member.id)

    await patchProfile(server, member.cookie, { introduction: 'I build saunas.' })

    const written = await cardsFor(member.id)
    expect(written.map((row) => row.event_id).toSorted()).toEqual([summer, autumn].toSorted())
    expect(written.map((row) => [row.kind, row.body, row.author])).toEqual([
      ['introduced', 'says who they are', member.id],
      ['introduced', 'says who they are', member.id],
    ])
  })

  it('leaves a burn that has already ended alone', async () => {
    const server = await build()
    const member = await givenMember({ name: 'Ada' })
    const over = await givenEvent({ slug: 'spring', start_date: '2026-05-01', end_date: '2026-05-03' })
    await givenComing(over, member.id)

    await patchProfile(server, member.cookie, { introduction: 'I build saunas.' })

    expect(await cardsFor(member.id)).toEqual([])
  })

  it('bumps the one card rather than leaving a line per rewrite', async () => {
    const server = await build()
    const member = await givenMember({ name: 'Ada' })
    const summer = await givenEvent({ slug: 'summer' })
    await givenComing(summer, member.id)

    await patchProfile(server, member.cookie, { introduction: 'I build saunas.' })
    await patchProfile(server, member.cookie, { introduction: 'I build saunas, mostly.' })
    await patchProfile(server, member.cookie, { introduction: 'I build saunas, mostly, and dig.' })

    expect(await cardsFor(member.id)).toHaveLength(1)
  })

  it('says nothing for a save that did not touch the introduction', async () => {
    // The entry count alone cannot fail this: `introduced` coalesces, so a redundant announce
    // leaves one row with the same body either way. What tells them apart is the bell (#449).
    const server = await build()
    const member = await givenMember({ name: 'Ada' })
    const other = await givenMember({ name: 'Bea' })
    const summer = await givenEvent({ slug: 'summer' })
    await givenComing(summer, member.id)
    await givenComing(summer, other.id)
    await listenFor(server, other.cookie, ['introduction_written'])
    await patchProfile(server, member.cookie, { introduction: 'I build saunas.' })

    await patchProfile(server, member.cookie, { allergies_notes: 'peanuts' })
    await patchProfile(server, member.cookie, { introduction: 'I build saunas.' })

    const written = await cardsFor(member.id)
    expect(written).toHaveLength(1)
    expect(written[0]?.body).toBe('says who they are')
    expect(await bell(server, other.cookie)).toHaveLength(1)
  })

  it('tells the burn once for however many passes at one paragraph', async () => {
    const server = await build()
    const member = await givenMember({ name: 'Ada' })
    const other = await givenMember({ name: 'Bea' })
    const summer = await givenEvent({ slug: 'summer' })
    await givenComing(summer, member.id)
    await givenComing(summer, other.id)
    await listenFor(server, other.cookie, ['introduction_written'])

    await patchProfile(server, member.cookie, { introduction: 'I build' })
    await patchProfile(server, member.cookie, { introduction: 'I build saunas' })
    await patchProfile(server, member.cookie, { introduction: 'I build saunas.' })

    expect(await cardsFor(member.id)).toHaveLength(1)
    expect(await bell(server, other.cookie)).toHaveLength(1)
  })

  it('says nothing when an introduction is cleared, since there is nothing to read', async () => {
    const server = await build()
    const member = await givenMember({ name: 'Ada' })
    const summer = await givenEvent({ slug: 'summer' })
    await givenComing(summer, member.id)

    await patchProfile(server, member.cookie, { introduction: '' })

    expect(await cardsFor(member.id)).toEqual([])
  })

  it('says nothing for somebody who is not coming to anything', async () => {
    const server = await build()
    const member = await givenMember({ name: 'Ada' })
    await givenEvent({ slug: 'summer' })

    await patchProfile(server, member.cookie, { introduction: 'I build saunas.' })

    expect(await cardsFor(member.id)).toEqual([])
  })

  it('titles the card with the name at the time, which the feed then re-resolves', async () => {
    const server = await build()
    const member = await givenMember({ name: 'Ada' })
    const summer = await givenEvent({ slug: 'summer' })
    await givenComing(summer, member.id)

    await patchProfile(server, member.cookie, { introduction: 'I build saunas.' })

    expect((await cardsFor(member.id))[0]?.title).toBe('Ada')
  })
})
