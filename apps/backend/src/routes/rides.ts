import type { Ride, RideEntry, RidesResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { apiRoutes, rideCreateSchema, ridesPage, rideTitle, rideUpdateSchema } from '@sage-burner/shared'
import { and, asc, eq, gte } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'
import type { Notifier } from '../push/notify.ts'

import { createGuards } from '../auth/guards.ts'
import { viewerFor } from '../auth/viewer.ts'
import { isForeignKeyViolation } from '../db/errors.ts'
import { isEmptyPatch, patchRow } from '../db/patch.ts'
import { account, event, ride, thread } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { displayName, tellAttendees } from '../push/notify.ts'
import { openEventNow, todayIso } from './events.ts'
import { addEntry, forgetThread, threadFor, threadIdFor } from './threads.ts'

export interface RideDeps extends GuardDeps {
  now: () => Date
  notify?: Notifier
}

const posted = (kind: Ride['kind']): string =>
  kind === 'offers' ? 'is offering a lift' : 'is looking for a lift'

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
      thread_id: thread.id,
    })
    .from(ride)
    .innerJoin(account, eq(ride.account_id, account.id))
    .leftJoin(thread, and(eq(thread.entity_type, 'ride'), eq(thread.entity_id, ride.id)))
    .where(eq(ride.event_id, eventId))
    .orderBy(asc(ride.created_at), asc(ride.id))

  return rows
}

const openJourney = async (db: Database, now: () => Date, id: string): Promise<Ride | undefined> => {
  const [row] = await db
    .select()
    .from(ride)
    .innerJoin(event, eq(ride.event_id, event.id))
    .where(and(eq(ride.id, id), gte(event.end_date, todayIso(now))))
    .limit(1)

  return row?.ride
}

export const registerRideRoutes = (
  app: FastifyInstance,
  { db, sessions, now, notify = async () => undefined }: RideDeps,
) => {
  const { requireApproved } = createGuards({ db, sessions })

  app.get<{ Params: { eventId: string } }>(
    apiRoutes.getRides.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

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

      let threadId: string
      try {
        threadId = db.transaction((tx) => {
          tx.insert(ride).values(row).run()

          return threadIdFor(tx, {
            type: 'ride',
            id: row.id,
            event_id: row.event_id,
            title: rideTitle(row),
          })
        })
      } catch (failure) {
        if (isForeignKeyViolation(failure)) return sendError(reply, 404)
        throw failure
      }

      await addEntry(
        db,
        { thread_id: threadId, kind: 'added', author_account_id: viewer.account_id, body: posted(row.kind) },
        now(),
      )

      const who = await displayName(db, viewer.account_id)

      await tellAttendees(
        db,
        notify,
        row.event_id,
        {
          category: 'ride_posted',
          body: `${who} ${posted(row.kind)} from ${row.from}`,
          link: ridesPage(row.event_id, row.id),
        },
        { except: [viewer.account_id] },
      )

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

      const changed =
        patched.row.kind !== existing.kind ||
        patched.row.from !== existing.from ||
        patched.row.when !== existing.when ||
        patched.row.seats !== existing.seats ||
        patched.row.notes !== existing.notes

      if (changed) {
        const threadId = await threadFor(db, 'ride', {
          id: patched.row.id,
          event_id: patched.row.event_id,
          title: rideTitle(patched.row),
        })

        await addEntry(
          db,
          {
            thread_id: threadId,
            kind: 'edited',
            author_account_id: viewer.account_id,
            body: 'went over it',
          },
          now(),
        )
      }

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

      db.transaction((tx) => {
        tx.delete(ride).where(eq(ride.id, existing.id)).run()
        forgetThread(tx, 'ride', existing.id)
      })

      return reply.code(204).send()
    },
  )
}
