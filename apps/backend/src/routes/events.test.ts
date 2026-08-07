import type { FastifyInstance } from 'fastify'

import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { SESSION_COOKIE } from '../auth/viewer.ts'
import { createConfig } from '../config.ts'
import { isCheckViolation } from '../db/errors.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole, event } from '../db/schema.ts'

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

const givenAccount = async (roles: ('admin' | 'member')[]) => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({
      id,
      email: `${id}@example.org`,
      password_hash: null,
      created_at: '2026-01-01T00:00:00.000Z',
    })
  for (const role of roles) await db().insert(accountRole).values({ account_id: id, role })

  const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })
  return `${SESSION_COOKIE}=${sessions.issue(id)}`
}

const givenAdmin = () => givenAccount(['admin'])

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
      payment_info_markdown: '',
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

const setWelcome = (
  server: FastifyInstance,
  cookie: string | undefined,
  id: string,
  payload: Record<string, unknown>,
) =>
  server.inject({
    method: 'PATCH',
    url: `/api/events/${id}/welcome`,
    headers: cookie === undefined ? {} : { cookie },
    payload,
  })

const valid = {
  name: 'Summer Burn 2026',
  slug: 'summer-2026',
  start_date: '2026-08-01',
  end_date: '2026-08-05',
  member_cap: 42,
}

describe('PATCH /api/events/:id/welcome', () => {
  it('lets any approved member rewrite the welcome text, admin or not', async () => {
    const server = await build()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })

    for (const roles of [['member'], ['admin'], ['member', 'admin']] as const) {
      const cookie = await givenAccount([...roles])
      const response = await setWelcome(server, cookie, id, { welcome_markdown: `By ${roles.join('+')}` })

      expect(response.statusCode, roles.join('+')).toBe(200)
      expect(response.json().event.welcome_markdown).toBe(`By ${roles.join('+')}`)
    }
  })

  it('refuses rewriting a burn that has ended, however approved the member', async () => {
    // #218. This was the one member-facing write keyed by a bare id that never looked
    // at `end_date`, so any approved member could rewrite a finished burn's welcome
    // text indefinitely — years later, on the page a past burn's link still opens.
    const server = await build('2026-09-01')
    const over = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })
    const cookie = await givenAccount(['member', 'admin'])

    const response = await setWelcome(server, cookie, over, { welcome_markdown: 'rewritten' })

    expect(response.statusCode).toBe(404)
    const [row] = await db().select().from(event).where(eq(event.id, over))
    expect(row?.welcome_markdown).toBe('')
  })

  it('still rewrites one that has not ended, including while it is running', async () => {
    // The passing sibling, and it pins the boundary that matters: the guard is
    // `openEvent`, so a burn in progress is still editable. A check against
    // `start_date` would pass the refusal above and break the burn everyone is at.
    const server = await build('2026-08-03')
    const running = await givenEvent({
      slug: 'summer-2026',
      start_date: '2026-08-01',
      end_date: '2026-08-05',
    })
    const cookie = await givenAccount(['member'])

    const response = await setWelcome(server, cookie, running, { welcome_markdown: 'still ours' })

    expect(response.statusCode).toBe(200)
    expect(response.json().event.welcome_markdown).toBe('still ours')
  })

  it('refuses a stranger and an account with no roles', async () => {
    const server = await build()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })
    const roleless = await givenAccount([])

    expect((await setWelcome(server, undefined, id, { welcome_markdown: 'x' })).statusCode).toBe(401)
    expect((await setWelcome(server, roleless, id, { welcome_markdown: 'x' })).statusCode).toBe(403)

    const [row] = await db().select().from(event).where(eq(event.id, id))
    expect(row?.welcome_markdown).toBe('')
  })

  it("refuses the burn's shape smuggled in beside the welcome text", async () => {
    // The whole reason this is its own route. `.strict()` makes a `member_cap`
    // here a 400 rather than a dropped key, so nobody can believe they raised the
    // cap — and a member cannot raise it at all, which is the point.
    const server = await build()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })
    const member = await givenAccount(['member'])

    const response = await setWelcome(server, member, id, { welcome_markdown: 'Hello', member_cap: 500 })

    expect(response.statusCode).toBe(400)
    const [row] = await db().select().from(event).where(eq(event.id, id))
    expect(row?.member_cap).toBe(42)
    expect(row?.welcome_markdown).toBe('')
  })

  it('still refuses a member at the admin route that writes the shape', async () => {
    // The sibling that proves the split did its job: opening the welcome text did
    // not open the dates or the cap.
    const server = await build()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })
    const member = await givenAccount(['member'])

    expect((await patch(server, member, id, { member_cap: 500 })).statusCode).toBe(403)
    expect((await patch(server, member, id, { welcome_markdown: 'Hello' })).statusCode).toBe(403)
  })

  it('answers 404 for a burn that does not exist', async () => {
    const server = await build()
    const member = await givenAccount(['member'])

    expect((await setWelcome(server, member, randomUUID(), { welcome_markdown: 'x' })).statusCode).toBe(404)
  })

  it('requires the field rather than treating an empty body as a no-op', async () => {
    // Unlike the admin PATCH, which is `.partial()` and answers `{}` with the row
    // unchanged. There is one field here, so an empty body is a malformed request.
    const server = await build()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })
    const member = await givenAccount(['member'])

    expect((await setWelcome(server, member, id, {})).statusCode).toBe(400)
  })
})

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
    // The slug is in URLs, so this is a thing the admin fixes by picking
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
    // The whole point of #11: an admin changes the welcome text and the
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
    // created with the `.default('')`, so an admin gets a 201 for an event
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

  it('rejects a whole event object patched back, the round-trip the README warns about', async () => {
    // The documented contract — "reading an event, editing the object and sending
    // the whole thing back is a 400 on `id` and `created_at`" — rests on two
    // independent facts: `.strict()`, and `id`/`created_at` being omitted from the
    // update schema. Either one changing alone breaks the promise, and the
    // `welcome` test covers `.strict()` for a different key for a different reason.
    const server = await build()
    const cookie = await givenAdmin()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })
    const [whole] = await db().select().from(event)
    if (whole === undefined) throw new Error('fixture missing')

    const response = await patch(server, cookie, id, { ...whole, name: 'Renamed' })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'bad_request' })
    const [row] = await db().select().from(event)
    expect(row).toMatchObject({ name: 'summer-2026' })
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
    // may legitimately carry one date. The handler reads the row, merges the
    // patch onto it and checks the result.
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
    // The realistic path: an admin opens the editor, changes nothing, clicks
    // Save. What it pins is that a write which changes no values is still a
    // success — not an error, and not "no such event".
    //
    // It pins the contract rather than a driver quirk, which matters because the
    // obvious implementation has one: a handler that decided from `changes` would
    // depend on SQLite counting a row whose SET values are identical, where MySQL
    // reports 0. `RETURNING` emits a row per row the `WHERE` matched, differing
    // values or not, so the answer here is the same on either engine.
    const server = await build()
    const cookie = await givenAdmin()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })
    await patch(server, cookie, id, { welcome_markdown: '# Bring water' })

    const response = await patch(server, cookie, id, { welcome_markdown: '# Bring water' })

    expect(response.statusCode).toBe(200)
    expect(response.json().event).toMatchObject({ welcome_markdown: '# Bring water' })
  })

  it('allows a one-sided date move that keeps the order, in either direction', async () => {
    // The guard must not have become "no single-date patches", and moving either
    // date needs a passing case, not just a rejecting one. Only `end_date` was
    // covered here, so nothing exercised a `start_date` move that should succeed.
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

  it('allows moving the whole range forward, with both dates in one patch', async () => {
    // A both-dates patch that is in order. Nothing exercised it: every other
    // both-dates PATCH here is out of order, so
    // `withEventDateOrder` rejects it at `safeParse` and the handler never reaches the
    // function with both set.
    //
    // Deleting that line is not harmless — the next branch would then compare the
    // *new* start against the *old* end column (`2026-09-01 <= 2026-08-05`), match
    // no rows, and refuse a perfectly ordinary "the burn moved to September".
    const server = await build()
    const cookie = await givenAdmin()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })

    const response = await patch(server, cookie, id, { start_date: '2026-09-01', end_date: '2026-09-05' })

    expect(response.statusCode).toBe(200)
    expect(response.json().event).toMatchObject({ start_date: '2026-09-01', end_date: '2026-09-05' })
    const [row] = await db().select().from(event)
    expect(row).toMatchObject({ start_date: '2026-09-01', end_date: '2026-09-05' })
  })

  // A one-day event is legal, so the ordering rule must admit an equal pair —
  // `<=`, not `<`, in the schema and in `event_date_order_check` alike.
  //
  // One case each, on its own fixture. They were a single test with two sequential
  // patches, and that only exercised the second boundary *because the first
  // succeeded*: under a strict `<` the start move is refused, the row stays
  // `08-01..08-05`, and the end move then evaluates `08-01 < 08-05` and passes. The
  // mutation was still caught, but by one assertion rather than the two the comment
  // claimed.
  it('allows a start date landing exactly on the end date', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })

    const response = await patch(server, cookie, id, { start_date: '2026-08-05' })

    expect(response.statusCode).toBe(200)
    const [row] = await db().select().from(event)
    expect(row).toMatchObject({ start_date: '2026-08-05', end_date: '2026-08-05' })
  })

  it('allows an end date landing exactly on the start date', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })

    const response = await patch(server, cookie, id, { end_date: '2026-08-01' })

    expect(response.statusCode).toBe(200)
    const [row] = await db().select().from(event)
    expect(row).toMatchObject({ start_date: '2026-08-01', end_date: '2026-08-01' })
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
    // The 409 was only covered on POST, and it matters more here because the
    // handler signals a conflict with an `undefined` sentinel out of `.catch()`
    // rather than by throwing — nothing else pins that `undefined` means "slug
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

describe('the hours a burn is open', () => {
  const client = () => {
    const found = handle?.client
    if (found === undefined) throw new Error('build() first')
    return found
  }

  it('defaults to the whole of both days, so a create form need not ask', async () => {
    const server = await build()
    const cookie = await givenAdmin()

    const response = await create(server, cookie, valid)

    expect(response.statusCode).toBe(201)
    expect(response.json().event).toMatchObject({ start_time: '00:00', end_time: '23:59' })
  })

  it('takes the hours an admin gives it', async () => {
    const server = await build()
    const cookie = await givenAdmin()

    const response = await create(server, cookie, {
      ...valid,
      start_time: '15:00',
      end_time: '12:00',
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().event).toMatchObject({ start_time: '15:00', end_time: '12:00' })
  })

  it('refuses a one-day burn that ends earlier in the day than it starts', async () => {
    const server = await build()
    const cookie = await givenAdmin()

    const response = await create(server, cookie, {
      ...valid,
      start_date: '2026-08-01',
      end_date: '2026-08-01',
      start_time: '22:00',
      end_time: '10:00',
    })

    expect(response.statusCode).toBe(400)
  })

  it('accepts a one-day burn that runs forwards', async () => {
    // The passing sibling: the rule must refuse the inverted pair, not every
    // single-day burn.
    const server = await build()
    const cookie = await givenAdmin()

    const response = await create(server, cookie, {
      ...valid,
      start_date: '2026-08-01',
      end_date: '2026-08-01',
      start_time: '10:00',
      end_time: '22:00',
    })

    expect(response.statusCode).toBe(201)
  })

  it('refuses a time that is not a clock time', async () => {
    const server = await build()
    const cookie = await givenAdmin()

    for (const bad of ['9:00', '24:00', '10:60', '1000']) {
      expect((await create(server, cookie, { ...valid, start_time: bad })).statusCode, bad).toBe(400)
    }
  })

  it('keeps a nonsense time out of the database, whatever the caller is', async () => {
    // The CHECK earns its place against writes that never see the Zod schema.
    await build()
    const row = (start: string, end: string) => () =>
      client()
        .prepare(
          'insert into event (id, name, slug, start_date, end_date, start_time, end_time, member_cap, created_at) values (?,?,?,?,?,?,?,?,?)',
        )
        .run(
          randomUUID(),
          'x',
          `s-${randomUUID().slice(0, 8)}`,
          '2026-08-01',
          '2026-08-05',
          start,
          end,
          42,
          '2026-01-01T00:00:00.000Z',
        )

    expect(row('9:00', '12:00')).toThrow()
    expect(row('24:00', '12:00')).toThrow()
    expect(row('10:00', '12:00')).not.toThrow()
  })

  it('answers 400, not 500, when a patch would invert the stored hours', async () => {
    // A multi-day burn may run 22:00 to 10:00. Narrowing it to one day makes that
    // pair invalid, and the body alone cannot see it.
    const server = await build()
    const cookie = await givenAdmin()
    const id = (await create(server, cookie, { ...valid, start_time: '22:00', end_time: '10:00' })).json()
      .event.id

    const response = await patch(server, cookie, id, {
      start_date: '2026-08-01',
      end_date: '2026-08-01',
    })

    expect(response.statusCode).toBe(400)
  })

  it('answers 400, not 500, when a patch inverts the times on a single-day burn', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    const id = (
      await create(server, cookie, {
        ...valid,
        start_date: '2026-08-01',
        end_date: '2026-08-01',
        start_time: '10:00',
        end_time: '22:00',
      })
    ).json().event.id

    expect((await patch(server, cookie, id, { start_time: '23:00' })).statusCode).toBe(400)
  })

  it('answers 404 for a patch against an event that is not there', async () => {
    // Answered by the read the ordering check needs, before the UPDATE runs —
    // not by the guard after it. That guard is for a row deleted *between* the
    // two, which `inject` cannot produce, so nothing here reaches it and this
    // test should not be read as covering it.
    const server = await build()
    const cookie = await givenAdmin()

    expect((await patch(server, cookie, randomUUID(), { name: 'Ghost' })).statusCode).toBe(404)
  })

  it('recognises the ordering CHECK by its message, so the race answers 400', async () => {
    // The predicate, pinned against a real violation rather than a hand-written
    // string — `inject` serialises two requests, so the path that uses it cannot
    // be reached under test. Same shape as `isAlreadyJoined` in `attendance.ts`,
    // and for the same reason: at least the message it matches cannot drift
    // unnoticed.
    await build()
    let raised: unknown

    try {
      client()
        .prepare(
          'insert into event (id, name, slug, start_date, end_date, start_time, end_time, member_cap, created_at) values (?,?,?,?,?,?,?,?,?)',
        )
        .run(
          randomUUID(),
          'x',
          'backwards-probe',
          '2026-08-01',
          '2026-08-01',
          '22:00',
          '10:00',
          42,
          '2026-01-01T00:00:00.000Z',
        )
    } catch (failure) {
      raised = failure
    }

    expect(isCheckViolation(raised, 'event_date_order_check')).toBe(true)
    expect(isCheckViolation(raised, 'event_member_cap_check')).toBe(false)
    expect(isCheckViolation(new Error('something else'), 'event_date_order_check')).toBe(false)
  })

  it('keeps an inverted single-day pair out too', async () => {
    await build()

    expect(() =>
      client()
        .prepare(
          'insert into event (id, name, slug, start_date, end_date, start_time, end_time, member_cap, created_at) values (?,?,?,?,?,?,?,?,?)',
        )
        .run(
          randomUUID(),
          'x',
          'backwards',
          '2026-08-01',
          '2026-08-01',
          '22:00',
          '10:00',
          42,
          '2026-01-01T00:00:00.000Z',
        ),
    ).toThrow()
  })
})
