import type { Ride, RideEntry, RidesResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { apiRoutes, rideCreateSchema, rideUpdateSchema } from '@sage-burner/shared'
import { and, asc, eq, gte } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'

import { createGuards } from '../auth/guards.ts'
import { viewerFor } from '../auth/viewer.ts'
import { isForeignKeyViolation } from '../db/errors.ts'
import { isEmptyPatch, patchRow } from '../db/patch.ts'
import { account, event, ride } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { openEventNow, todayIso } from './events.ts'

export interface RideDeps extends GuardDeps {
  now: () => Date
}

/**
 * The board for one burn, with each journey's poster resolved beside it.
 *
 * The name and the contact come from the account rather than from the row, which is
 * the whole reason there is no contact column: a member who changes their number
 * changes it once, on their own details page, and every lift they have offered says
 * the new one. A copy per row would be wrong exactly when somebody is trying to reach
 * them (#26).
 *
 * `contact` is shown to every approved member, which is what the roster already does
 * with it — see `docs/accounts.md`. It is the one field on the account that exists to
 * be given out.
 */
export const ridesFor = async (db: Database, eventId: string): Promise<RideEntry[]> => {
  const rows = await db
    .select({
      id: ride.id,
      event_id: ride.event_id,
      account_id: ride.account_id,
      kind: ride.kind,
      from: ride.from,
      when: ride.when,
      seats: ride.seats,
      notes: ride.notes,
      created_at: ride.created_at,
      name: account.name,
      contact: account.contact,
    })
    .from(ride)
    .innerJoin(account, eq(ride.account_id, account.id))
    .where(eq(ride.event_id, eventId))
    .orderBy(asc(ride.created_at), asc(ride.id))

  return rows
}

/**
 * The journey, when the burn it is for is still open — the id alone does not say.
 *
 * A finished burn's board is the record of who travelled with whom, and an id noted
 * while it was current should not still be a way to rewrite it. The same rule the
 * lanes and the register follow.
 */
const openJourney = async (db: Database, now: () => Date, id: string): Promise<Ride | undefined> => {
  const [row] = await db
    .select()
    .from(ride)
    .innerJoin(event, eq(ride.event_id, event.id))
    .where(and(eq(ride.id, id), gte(event.end_date, todayIso(now))))
    .limit(1)

  return row?.ride
}

/**
 * Getting to the burn and back (#26) — the spreadsheet's Rideshares tab.
 *
 * Two lists in one table: who **needs** a lift and who is **offering** one. Reading
 * is any approved member's, which is the point — the spreadsheet was a publicly
 * linked document and this is not.
 *
 * **Writing is your own journey's.** Unlike the lanes or the lead-roles register,
 * which are the burn's shared furniture and anyone may rearrange, a row here is
 * somebody's statement about their own travel and carries their contact. So the
 * update and delete guards ask whose it is, and answer 403 rather than 404 for
 * somebody else's — every member can already read the row, so hiding its existence
 * would say nothing and explain less.
 *
 * No `If-Match`. That exists for the fields several people edit at once (#274); one
 * of these has exactly one author.
 */
export const registerRideRoutes = (app: FastifyInstance, { db, sessions, now }: RideDeps) => {
  const { requireApproved } = createGuards({ db, sessions })

  app.get<{ Params: { eventId: string } }>(
    apiRoutes.getRides.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      // Reading a finished burn's board is reading its record, so this is not scoped
      // the way the writes are. An empty list for an id that names nothing is the
      // same answer as for a burn nobody has posted a journey to.
      return { rides: await ridesFor(db, request.params.eventId) } satisfies RidesResponse
    },
  )

  app.post<{ Params: { eventId: string } }>(
    apiRoutes.addRide.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(rideCreateSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const viewer = await viewerFor(request, { db, sessions })
      if (viewer === undefined) return sendError(reply, 401)

      const event_id = request.params.eventId
      if (!(await openEventNow(db, now, event_id))) return sendError(reply, 404)

      const row = {
        ...body,
        id: randomUUID(),
        event_id,
        account_id: viewer.account_id,
        created_at: now().toISOString(),
      } satisfies Ride

      try {
        await db.insert(ride).values(row)
      } catch (failure) {
        // A burn deleted between the check above and this insert. The check reads
        // `end_date`, which the foreign key cannot see.
        if (isForeignKeyViolation(failure)) return sendError(reply, 404)
        throw failure
      }

      return reply.code(201).send({ ride: row })
    },
  )

  app.patch<{ Params: { id: string } }>(
    apiRoutes.updateRide.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(rideUpdateSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const viewer = await viewerFor(request, { db, sessions })
      if (viewer === undefined) return sendError(reply, 401)

      const existing = await openJourney(db, now, request.params.id)
      if (existing === undefined) return sendError(reply, 404)
      if (existing.account_id !== viewer.account_id) return sendError(reply, 403)
      if (isEmptyPatch(body)) return { ride: existing }

      const patched = await patchRow(db, ride, eq(ride.id, request.params.id), body)
      if (patched.kind !== 'ok') return sendError(reply, 404)

      return { ride: patched.row }
    },
  )

  app.delete<{ Params: { id: string } }>(
    apiRoutes.deleteRide.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const viewer = await viewerFor(request, { db, sessions })
      if (viewer === undefined) return sendError(reply, 401)

      const existing = await openJourney(db, now, request.params.id)
      if (existing === undefined) return sendError(reply, 404)
      if (existing.account_id !== viewer.account_id) return sendError(reply, 403)

      await db.delete(ride).where(eq(ride.id, request.params.id))

      return reply.code(204).send()
    },
  )
}
