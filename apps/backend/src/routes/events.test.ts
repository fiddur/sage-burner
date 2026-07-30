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
    // The zero-rows branch reads `changes` as "rows matched". SQLite counts a row
    // whose SET values are identical, so this passes — and it is the realistic
    // path: an organiser opens the editor, changes nothing, clicks Save.
    //
    // What this test uniquely catches is a **driver swap** to one that reports 0
    // for an update whose values are unchanged (MySQL does). The row is still
    // there, so the re-read finds it and the handler answers **400
    // `bad_request`** — "check the dates and lengths" for a save that changed
    // nothing. Nothing else in the suite notices, because every other PATCH test
    // writes a genuinely new value; this one fails loudly because 400 is not 200.
    //
    // Two things it does *not* catch, listed because an earlier version of this
    // comment claimed it did:
    //
    // - `.returning()` on that statement makes `result` an array, so
    //   `result.changes` is `undefined` and `Number(undefined)` is `NaN` — the
    //   guard silently stops firing and a bad one-sided date move returns 200.
    //   What fails then is, on one line so it greps:
    //   `rejects a one-sided date move in either direction, and stores nothing`
    // - `setReadBigInts` is absorbed by the `Number(...)` in the handler
    //   (`Number(0n) === 0`), and a no-op save reports `1n` rather than `0n`
    //   anyway, so it is not a failure in either direction.
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

  it('answers 404 when the row vanishes between the read and the write', async () => {
    // The other cause of zero matched rows, and the reason the two are told apart:
    // with no date in the body there is no ordering condition in the `WHERE`, so
    // zero rows can only mean the row is gone — and 400 would blame the organiser's
    // body for something it did not do.
    //
    // The interleaving is forced rather than raced: the handler's first `select`
    // is answered with a row that is no longer in the database, which is exactly
    // what a concurrent delete looks like from inside the handler.
    const server = await build()
    const cookie = await givenAdmin()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })
    const [ghost] = await db().select().from(event)
    await db().delete(event).where(eq(event.id, id))

    // Only the handler's *first* read of `event` is stubbed. Counting selects
    // outright was the earlier approach and it is fragile twice over: the guard
    // spends a different number of them depending on whether `viewerFor` uses one
    // query or two, and the handler now re-reads `event` after a zero-row UPDATE —
    // which must reach the real database, or the 404 it exists to produce could not
    // happen.
    const live = db()
    const original = live.select.bind(live)
    let eventReads = 0
    live.select = ((...args: Parameters<typeof original>) => {
      const real = original(...args)

      return {
        from: (table: Parameters<typeof real.from>[0]) => {
          if (table !== event) return real.from(table)
          eventReads += 1
          if (eventReads > 1) return real.from(table)

          // A minimal stand-in for the query builder: the handler only awaits it.
          return { where: () => ({ limit: () => Promise.resolve([ghost]) }) }
        },
      }
    }) as typeof live.select

    const response = await patch(server, cookie, id, { welcome_markdown: 'anything' })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
    // The stub was consulted and the re-read went to the real database, so the 404
    // came from the vanished-row branch rather than the earlier existence check.
    expect(eventReads).toBe(2)
  })

  it('reports the row as written, not the snapshot it read', async () => {
    // The response used to be `{ ...existing, ...body }` — the pre-read row merged
    // with the change. Under interleaving that reports fields nobody stored: A
    // reads 08-01..08-05, B moves the end to 09-30, A moves the start to 09-01.
    // A's write is legitimate (09-01 is before 09-30, checked in the statement),
    // but the old response claimed `end_date: 08-05`, which is B's change undone
    // on paper only.
    const server = await build()
    const cookie = await givenAdmin()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })
    const [stale] = await db().select().from(event)

    // B's write lands between A's read and A's write.
    await db().update(event).set({ end_date: '2026-09-30' }).where(eq(event.id, id))

    const live = db()
    const original = live.select.bind(live)
    let eventReads = 0
    live.select = ((...args: Parameters<typeof original>) => {
      const real = original(...args)

      return {
        from: (table: Parameters<typeof real.from>[0]) => {
          if (table !== event) return real.from(table)
          eventReads += 1
          if (eventReads > 1) return real.from(table)

          return { where: () => ({ limit: () => Promise.resolve([stale]) }) }
        },
      }
    }) as typeof live.select

    const response = await patch(server, cookie, id, { start_date: '2026-09-01' })

    expect(response.statusCode).toBe(200)
    // Both fields as stored: A's start move and B's end move.
    expect(response.json().event).toMatchObject({ start_date: '2026-09-01', end_date: '2026-09-30' })
    const [row] = await original().from(event).where(eq(event.id, id))
    expect(response.json().event).toMatchObject({ start_date: row?.start_date, end_date: row?.end_date })
  })

  it('answers 404, not 400, when a valid one-sided move hits a deleted event', async () => {
    // The case the previous version got wrong: with an ordering condition in the
    // `WHERE`, zero rows was attributed to the body unconditionally. A perfectly
    // ordered move against an event someone else had just deleted therefore
    // answered `bad_request`, which the editor renders as "check the dates and
    // lengths" — dates that were never the problem.
    const server = await build()
    const cookie = await givenAdmin()
    const id = await givenEvent({ slug: 'summer-2026', start_date: '2026-08-01', end_date: '2026-08-05' })
    const [ghost] = await db().select().from(event)
    await db().delete(event).where(eq(event.id, id))

    const live = db()
    const original = live.select.bind(live)
    let eventReads = 0
    live.select = ((...args: Parameters<typeof original>) => {
      const real = original(...args)

      return {
        from: (table: Parameters<typeof real.from>[0]) => {
          if (table !== event) return real.from(table)
          eventReads += 1
          if (eventReads > 1) return real.from(table)

          return { where: () => ({ limit: () => Promise.resolve([ghost]) }) }
        },
      }
    }) as typeof live.select

    // Well ordered against the row as read: 2026-08-02 sits inside 08-01..08-05.
    const response = await patch(server, cookie, id, { start_date: '2026-08-02' })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
    expect(eventReads).toBe(2)
  })

  it("answers 409 when a patch takes another event's slug", async () => {
    // The 409 was only covered on POST, and it matters more here: this branch
    // changed the mechanism from a try/catch around the await to an `undefined`
    // sentinel out of `.catch()`, and nothing pinned that `result === undefined`
    // means "slug conflict" rather than "the driver returned nothing". A
    // `.returning()` added to that statement would make `result` an array and
    // quietly change what both that check and the `changes` check mean.
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
