import type { FastifyInstance } from 'fastify'

import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole, event } from '../db/schema.ts'
import { SESSION_COOKIE } from './auth.ts'

/**
 * Events, and the rule for which one is "active".
 *
 * The clock is injected throughout — an active-event rule tested against the
 * real date passes in July and fails in September, which is the worst kind of
 * test to own.
 */

const SECRET = 's'.repeat(40)

let handle: DbHandle | undefined
let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  handle?.close()
  app = undefined
  handle = undefined
})

const build = async (today = '2026-06-01') => {
  handle = createDb({ url: ':memory:' })
  runMigrations(handle)
  app = await createApp({
    db: handle.db,
    config: createConfig({ LOG_LEVEL: 'silent', SESSION_SECRET: SECRET }),
    now: () => new Date(`${today}T12:00:00.000Z`),
  })
  return app
}

const db = () => {
  const found = handle?.db
  if (found === undefined) throw new Error('build() first')
  return found
}

const givenAdmin = async () => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({
      id,
      email: `${id}@example.org`,
      password_hash: null,
      created_at: '2026-01-01T00:00:00.000Z',
    })
  await db().insert(accountRole).values({ account_id: id, role: 'admin' })

  const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })
  return `${SESSION_COOKIE}=${sessions.issue(id)}`
}

const givenEvent = async (fields: { slug: string; start_date: string; end_date: string; name?: string }) => {
  const id = randomUUID()
  await db()
    .insert(event)
    .values({
      id,
      name: fields.name ?? fields.slug,
      slug: fields.slug,
      start_date: fields.start_date,
      end_date: fields.end_date,
      welcome_markdown: '',
      member_cap: 42,
      created_at: '2026-01-01T00:00:00.000Z',
    })
  return id
}

const active = (server: FastifyInstance) => server.inject({ method: 'GET', url: '/api/events/active' })

const create = (server: FastifyInstance, cookie: string, payload: Record<string, unknown>) =>
  server.inject({ method: 'POST', url: '/api/admin/events', headers: { cookie }, payload })

const patch = (server: FastifyInstance, cookie: string, id: string, payload: Record<string, unknown>) =>
  server.inject({ method: 'PATCH', url: `/api/admin/events/${id}`, headers: { cookie }, payload })

const valid = {
  name: 'Summer Burn 2026',
  slug: 'summer-2026',
  start_date: '2026-08-01',
  end_date: '2026-08-05',
  member_cap: 42,
}

describe('GET /api/events/active', () => {
  it('is null before any event exists', async () => {
    // A fresh deployment. Not a 404 — the homepage renders an explanation.
    const server = await build()

    const response = await active(server)

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ event: null })
  })

  it('is reachable signed out', async () => {
    const server = await build()
    await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })

    expect((await active(server)).statusCode).toBe(200)
  })

  it('picks the soonest-ending event that has not ended', async () => {
    const server = await build('2026-06-01')
    await givenEvent({ slug: 'winter-2026', start_date: '2026-12-01', end_date: '2026-12-05' })
    await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })

    expect((await active(server)).json().event.slug).toBe('summer-2026')
  })

  it('still counts an event that is running today', async () => {
    // Mid-burn is exactly when the homepage matters most; a rule keyed on the
    // start date would have dropped it the moment it began.
    const server = await build('2026-08-03')
    await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })

    expect((await active(server)).json().event.slug).toBe('summer-2026')
  })

  it('still counts an event ending today', async () => {
    const server = await build('2026-08-05')
    await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })

    expect((await active(server)).json().event.slug).toBe('summer-2026')
  })

  it('is null once every event has ended', async () => {
    // Deliberate: last year's welcome text must not stay up as though it were
    // an invitation. Creating the next event is what fills the gap.
    const server = await build('2026-08-06')
    await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })

    expect((await active(server)).json()).toEqual({ event: null })
  })

  it('breaks a tie deterministically', async () => {
    const server = await build('2026-06-01')
    await givenEvent({ slug: 'b-burn', start_date: '2026-08-02', end_date: '2026-08-05' })
    await givenEvent({ slug: 'a-burn', start_date: '2026-08-01', end_date: '2026-08-05' })

    // Same end date, so the earlier start wins.
    expect((await active(server)).json().event.slug).toBe('a-burn')
  })

  it('is marked no-cache so an edit is not served stale', async () => {
    const server = await build()

    expect((await active(server)).headers['cache-control']).toBe('no-cache')
  })
})

describe('admin event routes', () => {
  it('refuse an anonymous caller', async () => {
    // The signed-in-but-not-admin case lives in `auth/guards.test.ts`, which is
    // where the guard itself is exercised; duplicating it here would test the
    // same preHandler twice.
    const server = await build()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })

    expect((await server.inject({ method: 'GET', url: '/api/admin/events' })).statusCode).toBe(401)
    expect(
      (await server.inject({ method: 'POST', url: '/api/admin/events', payload: valid })).statusCode,
    ).toBe(401)
    // PATCH was missing while the name claimed the whole route group. It shares
    // the preHandler, so the risk was low — but a test's name should not be
    // broader than its assertions.
    expect(
      (
        await server.inject({
          method: 'PATCH',
          url: `/api/admin/events/${id}`,
          payload: { welcome_markdown: 'x' },
        })
      ).statusCode,
    ).toBe(401)
  })

  it('create an event and return it', async () => {
    const server = await build()
    const cookie = await givenAdmin()

    const response = await create(server, cookie, valid)

    expect(response.statusCode).toBe(201)
    expect(response.json().event).toMatchObject({ slug: 'summer-2026', member_cap: 42 })
    expect(response.json().event.id).toBeTruthy()
  })

  it('default the welcome text to empty so an event can exist before it is written', async () => {
    const server = await build()
    const cookie = await givenAdmin()

    const response = await create(server, cookie, valid)

    expect(response.json().event.welcome_markdown).toBe('')
  })

  it('reject a duplicate slug with 409 rather than 500', async () => {
    // The slug is in URLs, so this is a thing the organiser fixes by picking
    // another — it needs to be distinguishable from a server fault.
    const server = await build()
    const cookie = await givenAdmin()
    await create(server, cookie, valid)

    const response = await create(server, cookie, { ...valid, name: 'Another' })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ error: 'conflict' })
  })

  it('reject an end date before the start date', async () => {
    const server = await build()
    const cookie = await givenAdmin()

    const response = await create(server, cookie, {
      ...valid,
      start_date: '2026-08-05',
      end_date: '2026-08-01',
    })

    expect(response.statusCode).toBe(400)
  })

  it('list events by start date', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    await givenEvent({ slug: 'winter-2026', start_date: '2026-12-01', end_date: '2026-12-05' })
    await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })

    const response = await server.inject({ method: 'GET', url: '/api/admin/events', headers: { cookie } })

    expect(response.json().events.map((row: { slug: string }) => row.slug)).toEqual([
      'summer-2026',
      'winter-2026',
    ])
  })

  it('edit the welcome text without restating the event', async () => {
    // The whole point of #11: an organiser changes the welcome text and the
    // public page reflects it, with no redeploy and no risk of clobbering the
    // dates someone else just fixed.
    const server = await build('2026-06-01')
    const cookie = await givenAdmin()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })

    const response = await patch(server, cookie, id, { welcome_markdown: '# Welcome, bring water' })

    expect(response.statusCode).toBe(200)
    expect((await active(server)).json().event.welcome_markdown).toBe('# Welcome, bring water')
  })

  it('leave untouched fields alone', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })

    await patch(server, cookie, id, { welcome_markdown: 'hello' })

    const [row] = await db().select().from(event)
    expect(row).toMatchObject({ slug: 'summer-2026', start_date: '2026-08-01', member_cap: 42 })
  })

  it('treats an empty patch as a no-op rather than a 500', async () => {
    // `set({})` is not valid SQL, so drizzle refuses it outright — this used to
    // answer `internal_error` with a stack in the log. A no-op PATCH is
    // idempotent, so the row comes back unchanged.
    const server = await build()
    const cookie = await givenAdmin()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })

    const response = await patch(server, cookie, id, {})

    expect(response.statusCode).toBe(200)
    expect(response.json().event).toMatchObject({ slug: 'summer-2026', welcome_markdown: '' })
  })

  it('rejects an unrecognised key on create too, not only on update', async () => {
    // Otherwise `welcome` for `welcome_markdown` is stripped and the event is
    // created with the `.default('')`, so an organiser gets a 201 for an event
    // whose welcome text is silently empty. Same argument as the update path; the
    // two schemas should not differ for no stated reason.
    const server = await build()
    const cookie = await givenAdmin()

    const response = await create(server, cookie, { ...valid, welcome: 'typo' })

    expect(response.statusCode).toBe(400)
    expect(await db().select().from(event)).toHaveLength(0)
  })

  it('answers 404 for an empty patch against an event that does not exist', async () => {
    // The one branch that decides what `{}` means when there is no row. It is the
    // only path that still reads before writing, so it is also the only place a
    // missing event is detected without the `UPDATE` doing it.
    const server = await build()
    const cookie = await givenAdmin()

    const response = await patch(server, cookie, randomUUID(), {})

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
  })

  it('rejects an unrecognised key instead of answering "saved"', async () => {
    // `welcome` for `welcome_markdown` is a plausible typo against a partial
    // endpoint. A non-strict schema stripped it, the body became `{}`, and the
    // no-op path above answered 200 — which the editor renders as "Saved."
    // while nothing was written. Silent success is worse to diagnose than a 500.
    const server = await build()
    const cookie = await givenAdmin()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })

    const response = await patch(server, cookie, id, { welcome: 'typo' })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'bad_request' })
  })

  it('rejects a patch with both dates in the wrong order', async () => {
    // Rejected by `withEventDateOrder` before the handler sees it, which is why
    // the handler carries no both-dates check. Nothing covered this on the update
    // path before — only on POST — so relaxing that refine would have gone
    // unnoticed until an out-of-order pair reached the database CHECK.
    const server = await build()
    const cookie = await givenAdmin()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })

    const response = await patch(server, cookie, id, { start_date: '2026-09-01', end_date: '2026-08-20' })

    expect(response.statusCode).toBe(400)
    const [row] = await db().select().from(event)
    expect(row).toMatchObject({ start_date: '2026-08-01', end_date: '2026-08-05' })
  })

  it('rejects a one-sided date move in either direction, and stores nothing', async () => {
    // The schema cannot catch this: it tolerates a partial range, since a PATCH
    // may legitimately carry one date. The handler puts the condition in the
    // UPDATE's `where` so it is evaluated against the row at write time.
    //
    // What these assertions distinguish is that a one-sided move is refused and
    // the row is untouched — **not** that the decision happens inside the
    // statement. A read-then-check implementation passes this identically. The
    // in-statement property is real (it is what stops a concurrent move to the
    // other date reaching `event_date_order_check` as a 500) but it is not
    // observable from two sequential requests, so nothing here defends it; the
    // reachability of `dateOrderCondition` is what this covers.
    const server = await build()
    const cookie = await givenAdmin()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })

    const movedStart = await patch(server, cookie, id, { start_date: '2026-09-01' })
    const movedEnd = await patch(server, cookie, id, { end_date: '2026-07-01' })

    expect(movedStart.statusCode).toBe(400)
    expect(movedStart.json()).toEqual({ error: 'bad_request' })
    expect(movedEnd.statusCode).toBe(400)
    const [row] = await db().select().from(event)
    expect(row).toMatchObject({ start_date: '2026-08-01', end_date: '2026-08-05' })
  })

  it('answers 200 when the welcome text is re-saved unchanged', async () => {
    // The realistic path: an organiser opens the editor, changes nothing, clicks
    // Save. What it pins is that a write which changes no values is still a
    // success — not an error, and not "no such event".
    //
    // It used to guard something narrower and more fragile: the handler read
    // `changes`, which meant it depended on SQLite counting a row whose SET values
    // are identical, where MySQL reports 0. `.returning()` removed that — `RETURNING`
    // emits a row per row the `WHERE` matched, whether or not the values differ —
    // so this no longer defends a driver-specific coupling, because there is not
    // one. It defends the contract instead, which is the part a member would feel.
    const server = await build()
    const cookie = await givenAdmin()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })
    await patch(server, cookie, id, { welcome_markdown: '# Bring water' })

    const response = await patch(server, cookie, id, { welcome_markdown: '# Bring water' })

    expect(response.statusCode).toBe(200)
    expect(response.json().event).toMatchObject({ welcome_markdown: '# Bring water' })
  })

  it('allows a one-sided date move that keeps the order, in either direction', async () => {
    // The guard must not have become "no single-date patches" — and both branches
    // of `dateOrderCondition` need a passing case, not just the rejecting one.
    // Only `end_date` was covered here, so nothing exercised the `start_date`
    // branch in the direction that should succeed.
    const server = await build()
    const cookie = await givenAdmin()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })

    const movedEnd = await patch(server, cookie, id, { end_date: '2026-08-09' })
    const movedStart = await patch(server, cookie, id, { start_date: '2026-08-03' })

    expect(movedEnd.statusCode).toBe(200)
    expect(movedStart.statusCode).toBe(200)
    const [row] = await db().select().from(event)
    expect(row).toMatchObject({ start_date: '2026-08-03', end_date: '2026-08-09' })
  })

  it('allows a one-day event, where the range collapses to a single date', async () => {
    // The boundary neither branch covered. `event_date_order_check` is
    // `end_date >= start_date`, so a one-day event is legal — but a strict `<`
    // slipped into `dateOrderCondition` in place of `<=` would 400 both of these
    // and no test would have noticed.
    const server = await build()
    const cookie = await givenAdmin()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })

    const startOntoEnd = await patch(server, cookie, id, { start_date: '2026-08-05' })
    expect(startOntoEnd.statusCode).toBe(200)

    const endOntoStart = await patch(server, cookie, id, { end_date: '2026-08-05' })
    expect(endOntoStart.statusCode).toBe(200)

    const [row] = await db().select().from(event)
    expect(row).toMatchObject({ start_date: '2026-08-05', end_date: '2026-08-05' })
  })

  it('answers 404, not 400, when a valid one-sided move hits a deleted event', async () => {
    // Zero matched rows has two causes when an ordering condition is in the
    // `WHERE`: the condition failed, or the row is gone. Guessing attributed it to
    // the body, so a perfectly ordered move against a deleted event answered
    // `bad_request` — which the editor renders as "check the dates and lengths",
    // dates that were never the problem. The handler re-reads instead.
    //
    // No stub any more: since the pre-read moved inside the empty-body branch,
    // nothing is read before the write, so a deleted row reaches the same path a
    // concurrent delete would.
    const server = await build()
    const cookie = await givenAdmin()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })
    await db().delete(event).where(eq(event.id, id))

    // Well ordered against the row as it was: 2026-08-02 sits inside 08-01..08-05.
    const response = await patch(server, cookie, id, { start_date: '2026-08-02' })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
  })
  it("answers 409 when a patch takes another event's slug", async () => {
    // The 409 was only covered on POST, and it matters more here: this branch
    // changed the mechanism from a try/catch around the await to an `undefined`
    // sentinel out of `.catch()`, and nothing pinned that `undefined` means "slug
    // conflict" rather than "the driver returned nothing".
    //
    // That distinction carries more weight since `.returning()` landed, because the
    // handler now reads two different empty-ish results from the same statement:
    // `undefined` from the `.catch()` is a conflict (409), and `[]` is "no row
    // matched" (400 or 404). Collapsing them would answer the wrong one.
    const server = await build()
    const cookie = await givenAdmin()
    await givenEvent({ slug: 'winter-2026', start_date: '2026-12-01', end_date: '2026-12-05' })
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })

    const response = await patch(server, cookie, id, { slug: 'winter-2026' })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ error: 'conflict' })
  })

  it('answer 404 for an event that does not exist', async () => {
    const server = await build()
    const cookie = await givenAdmin()

    const response = await patch(server, cookie, randomUUID(), { welcome_markdown: 'x' })

    expect(response.statusCode).toBe(404)
  })

  it('keep the roster of events out of caches', async () => {
    const server = await build()
    const cookie = await givenAdmin()

    const response = await server.inject({ method: 'GET', url: '/api/admin/events', headers: { cookie } })

    expect(response.headers['cache-control']).toBe('no-store')
  })
})
