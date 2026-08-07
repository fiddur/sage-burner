import type { CopySourcesResponse, Place, PlacesResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import {
  apiRoutes,
  placeCopySchema,
  placeCreateSchema,
  placeOrderSchema,
  placeUpdateSchema,
} from '@sage-burner/shared'
import { and, asc, eq, gte } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'

import { createGuards } from '../auth/guards.ts'
import { isForeignKeyViolation } from '../db/errors.ts'
import { nextOrder, reorder } from '../db/ordered.ts'
import { isEmptyPatch, patchRow } from '../db/patch.ts'
import { event, place } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { refuseIfStale, withCollectionVersion, withVersion } from '../if-match.ts'
import { copySourcesFor } from './copy-sources.ts'
import { openEventNow, todayIso } from './events.ts'

export interface PlaceDeps extends GuardDeps {
  now: () => Date
}

export const placesFor = (db: Database, eventId: string): Promise<Place[]> =>
  db.select().from(place).where(eq(place.event_id, eventId)).orderBy(asc(place.order), asc(place.id))

/**
 * The lane, when the burn it belongs to is open — the id alone does not say which.
 *
 * A finished burn's grid is the record of what happened there, and an id noted while
 * it was current should not still be a way to rewrite it. Every write here is scoped
 * the same way; reading stays open, including reading a finished grid to copy it into
 * the next burn.
 */
const openLane = async (db: Database, now: () => Date, placeId: string): Promise<Place | undefined> => {
  const [row] = await db
    .select()
    .from(place)
    .innerJoin(event, eq(place.event_id, event.id))
    .where(and(eq(place.id, placeId), gte(event.end_date, todayIso(now))))
    .limit(1)

  return row?.place
}

/**
 * Where a dream can happen, one grid per burn.
 *
 * Rows rather than code, the same as the application questions: the site changes
 * between burns and adding a place must never need a redeploy. **Per event**, so a
 * summer-only spot is not a lane in the winter grid and last year's event tent does
 * not outlive it (#156) — with a copy action, because the overlap between burns is
 * large and retyping it is the friction worth removing.
 *
 * Reads are public. The ICS feed publishes a session's location to anyone with the
 * link, so the list of places is already public by design — see the ICS paragraph
 * in `docs/burns.md`'s calendar-feed section. Every write is open to any approved
 * member: this
 * is the burn's furniture, not admin's. Every write also needs the burn to be open;
 * see `openEventNow`.
 */
export const registerPlaceRoutes = (app: FastifyInstance, { db, sessions, now }: PlaceDeps) => {
  const { requireApproved } = createGuards({ db, sessions })

  /**
   * The grid, as both the `GET` and every `If-Match` guard below see it (#274).
   *
   * One function, because a guard computing its own shape would tag something other
   * than what the caller was shown and refuse every write forever.
   */
  const grid = async (eventId: string): Promise<PlacesResponse> => ({
    places: await placesFor(db, eventId),
  })

  app.get<{ Params: { eventId: string } }>(apiRoutes.getPlaces.fastify, async (request, reply) => {
    // Same reasoning as the questions and the active event: public, but an edit
    // has to show up without waiting out a heuristic freshness window.
    void reply.header('cache-control', 'no-cache')

    return withVersion(reply, await grid(request.params.eventId))
  })

  app.post<{ Params: { eventId: string } }>(
    apiRoutes.addPlace.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(placeCreateSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const id = randomUUID()
      const event_id = request.params.eventId

      if (!(await openEventNow(db, now, event_id))) {
        return sendError(reply, 404)
      }

      // Read and insert in one transaction, or "the server assigns `order`" is not
      // true: two requests can observe the same last row between separate awaits
      // and claim the same position. Returned from the callback rather than
      // assigned into a row inside it — that would work only because
      // `drizzle-orm/node-sqlite` is synchronous, and on an async driver the
      // insert would be right while the 201 body reported `order: 0`.
      //
      // The last row is *this burn's* last row. Numbering across all burns would
      // start a new burn's first lane at whatever the previous one reached.
      let order: number
      try {
        order = db.transaction((tx) => {
          const next = nextOrder(tx, place, eq(place.event_id, event_id))
          tx.insert(place)
            .values({ ...body, id, event_id, order: next })
            .run()

          return next
        })
      } catch (failure) {
        // A burn deleted between the check above and this insert. The check reads
        // `end_date`, which the foreign key cannot see; the key covers existence,
        // which the check can only report as of a moment ago.
        if (isForeignKeyViolation(failure)) return sendError(reply, 404)
        throw failure
      }

      return reply.code(201).send({ place: { ...body, id, event_id, order } satisfies Place })
    },
  )

  app.patch<{ Params: { id: string } }>(
    apiRoutes.updatePlace.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(placeUpdateSchema, request)
      if (body === undefined) return sendError(reply, 400)

      // One read answering both "is it there" and "is its burn still open", so the
      // two cases cannot answer differently. It also answers the one body that never
      // reaches the UPDATE — see `isEmptyPatch`.
      const existing = await openLane(db, now, request.params.id)
      if (existing === undefined) return sendError(reply, 404)
      if (isEmptyPatch(body)) return { place: existing }

      // After the lookup, so a lane that is gone answers 404 rather than a grid it is
      // not in, and after the no-op, which reads rather than writes.
      if (await refuseIfStale(request, reply, () => grid(existing.event_id))) return reply

      const patched = await patchRow(db, place, eq(place.id, request.params.id), body)
      if (patched.kind !== 'ok') return sendError(reply, 404)

      return await withCollectionVersion(reply, { place: patched.row }, () => grid(existing.event_id))
    },
  )

  app.delete<{ Params: { id: string } }>(
    apiRoutes.deletePlace.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      if ((await openLane(db, now, request.params.id)) === undefined) {
        return sendError(reply, 404)
      }

      // A dream sitting in this lane holds the row: `session.place_id` has no
      // `onDelete`, so SQLite refuses rather than quietly unscheduling it. Left to
      // the constraint rather than pre-read, because a constraint cannot go stale
      // and a read can.
      //
      // The `openLane` read above can, and that window is accepted rather than
      // closed: `PATCH /api/admin/events/:id` moves `end_date`, so an admin
      // shortening a burn between that read and this delete would let a lane go from
      // a burn that just closed. The same shape as the burn vanishing between the
      // check and the insert on POST, and left open for the same reason: two people
      // doing those two things in the same second, at forty-odd members and four
      // burns a year, is not worth a transaction to prevent.
      let deleted
      try {
        deleted = await db.delete(place).where(eq(place.id, request.params.id)).returning({ id: place.id })
      } catch (failure) {
        if (isForeignKeyViolation(failure)) return sendError(reply, 409)
        throw failure
      }

      if (deleted.length === 0) return sendError(reply, 404)

      // Deliberately does not renumber the survivors: `order` only has to sort,
      // not be contiguous, and renumbering here would fight a concurrent
      // reorder for no visible gain.
      return reply.code(204).send()
    },
  )

  app.put<{ Params: { eventId: string } }>(
    apiRoutes.reorderPlaces.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(placeOrderSchema, request)
      if (body === undefined) return sendError(reply, 400)

      if (!(await openEventNow(db, now, request.params.eventId))) {
        return sendError(reply, 404)
      }

      if (await refuseIfStale(request, reply, () => grid(request.params.eventId))) return reply

      // Exactly the places this burn has — `reorder` argues that rule out, and
      // scoping by event as well as id is what keeps another burn's grid out of
      // reach even if the set check were wrong.
      const renumbered = reorder(
        db,
        place,
        await placesFor(db, request.params.eventId),
        body.ids,
        eq(place.event_id, request.params.eventId),
      )
      if (renumbered === 'mismatch') return sendError(reply, 400)

      return withVersion(reply, await grid(request.params.eventId))
    },
  )

  /** The burns whose grid this one's could be seeded from, newest first. */
  app.get<{ Params: { eventId: string } }>(
    apiRoutes.getPlaceSources.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const sources = await copySourcesFor(
        db,
        { table: place, eventColumn: place.event_id, idColumn: place.id },
        request.params.eventId,
      )

      return { sources } satisfies CopySourcesResponse
    },
  )

  /**
   * Seed this burn's grid from a previous burn's.
   *
   * The lanes, never the dreams standing in them: which burn's Temple a dream was in
   * is a fact about that burn. Refuses when this burn already has lanes, for the same
   * reason the roles register does — merging two grids is a decision nobody asked
   * for, and "copy into empty" is the case that removes the retyping.
   *
   * The check and the inserts are one transaction, or that refusal holds only when
   * nobody clicks twice at once. As with the register, `inject` runs requests to
   * completion in turn, so no test here can exercise that window.
   */
  app.post<{ Params: { eventId: string } }>(
    apiRoutes.copyPlaces.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(placeCopySchema, request)
      if (body === undefined) return sendError(reply, 400)
      if (body.from_event_id === request.params.eventId) {
        return sendError(reply, 400)
      }

      const today = todayIso(now)

      const seeded = db.transaction((tx) => {
        // Checked rather than left to the foreign key. The FK only fires when there
        // is a row to insert, so copying from an empty source into a burn that does
        // not exist answered 201 with an empty list — the one combination the other
        // 404 test cannot reach. It also carries the `end_date` half, which the key
        // cannot see: a grid is seeded into a burn still to come, never back into a
        // finished one.
        const [burn] = tx
          .select({ id: event.id })
          .from(event)
          .where(and(eq(event.id, request.params.eventId), gte(event.end_date, today)))
          .limit(1)
          .all()

        if (burn === undefined) return 'not_found' as const

        // The source too, and for the same reason. Without it, copying *from* a burn
        // that does not exist answered 201 with nothing copied — no different from a
        // real burn that simply has none. Existence only: copying forward out of a
        // finished burn is the case the whole action was built for.
        const [from] = tx
          .select({ id: event.id })
          .from(event)
          .where(eq(event.id, body.from_event_id))
          .limit(1)
          .all()

        if (from === undefined) return 'not_found' as const

        const [already] = tx
          .select({ id: place.id })
          .from(place)
          .where(eq(place.event_id, request.params.eventId))
          .limit(1)
          .all()

        if (already !== undefined) return 'conflict' as const

        const source = tx
          .select()
          .from(place)
          .where(eq(place.event_id, body.from_event_id))
          .orderBy(asc(place.order), asc(place.id))
          .all()

        // `order` is carried rather than reassigned, so the copied grid reads left
        // to right the way the burn it came from did.
        for (const row of source) {
          tx.insert(place)
            .values({
              id: randomUUID(),
              event_id: request.params.eventId,
              order: row.order,
              name: row.name,
              emoji: row.emoji,
              color: row.color,
            })
            .run()
        }

        return 'copied' as const
      })

      if (seeded === 'not_found') return sendError(reply, 404)
      if (seeded === 'conflict') return sendError(reply, 409)

      return reply
        .code(201)
        .send({ places: await placesFor(db, request.params.eventId) } satisfies PlacesResponse)
    },
  )
}
