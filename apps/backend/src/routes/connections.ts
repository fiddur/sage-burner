import type { Connection, ConnectionResponse, ConnectionsResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import {
  apiRoutes,
  connectionCreateSchema,
  connectionOrderSchema,
  connectionUpdateSchema,
  MAX_CONNECTIONS,
} from '@sage-burner/shared'
import { and, asc, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'

import { createGuards } from '../auth/guards.ts'
import { viewerFor } from '../auth/viewer.ts'
import { isUniqueViolation } from '../db/errors.ts'
import { nextOrder, reorder } from '../db/ordered.ts'
import { accountConnection } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'

/** One account's list, in the order they put it in. */
export const connectionsFor = async (db: Database, accountId: string): Promise<Connection[]> =>
  await db
    .select()
    .from(accountConnection)
    .where(eq(accountConnection.account_id, accountId))
    .orderBy(asc(accountConnection.order), asc(accountConnection.id))

/**
 * The ways somebody can be reached, which are their own to write (#388).
 *
 * Outside `/api/admin/` and outside anybody else's reach: whose rows these are comes from
 * the session, never from a body, which is the rule `profile.ts` already holds for a
 * name, a contact and an allergy. Reading somebody else's list belongs to their profile
 * page and is a separate route.
 *
 * **No `If-Match`.** Preconditions are for the burn's shared furniture (#274), where two
 * people edit one thing; this is one person's own record with exactly one writer.
 */
export const registerConnectionRoutes = (app: FastifyInstance, { db, sessions }: GuardDeps) => {
  const { requireApproved } = createGuards({ db, sessions })

  const guarded = { preHandler: requireApproved }

  app.get(apiRoutes.getMyConnections.fastify, guarded, async (request, reply) => {
    void noStore(reply)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return sendError(reply, 401)

    return { connections: await connectionsFor(db, viewer.account_id) } satisfies ConnectionsResponse
  })

  app.post(apiRoutes.addMyConnection.fastify, guarded, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(connectionCreateSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return sendError(reply, 401)

    const held = await connectionsFor(db, viewer.account_id)
    if (held.length >= MAX_CONNECTIONS) return sendError(reply, 409)

    const id = randomUUID()

    try {
      // One transaction, for the reason `nextOrder` gives. Scoped to the account, so
      // somebody's first way of being reached starts at zero.
      const order = db.transaction((tx) => {
        const next = nextOrder(tx, accountConnection, eq(accountConnection.account_id, viewer.account_id))
        tx.insert(accountConnection)
          .values({ ...body, id, account_id: viewer.account_id, order: next })
          .run()

        return next
      })

      return reply.code(201).send({
        connection: { ...body, id, account_id: viewer.account_id, order },
      } satisfies ConnectionResponse)
    } catch (failure) {
      // The same handle twice on one account. A 409 rather than a silent second row,
      // since the list is what somebody reads to know how to reach this person.
      if (isUniqueViolation(failure)) return sendError(reply, 409)
      throw failure
    }
  })

  app.patch<{ Params: { id: string } }>(
    apiRoutes.updateMyConnection.fastify,
    guarded,
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(connectionUpdateSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const viewer = await viewerFor(request, { db, sessions })
      if (viewer === undefined) return sendError(reply, 401)

      try {
        // The account id is in the `WHERE`, so somebody else's row is a 404 rather than
        // a write — the id is the only thing a caller supplies here.
        const [updated] = await db
          .update(accountConnection)
          .set(body)
          .where(
            and(
              eq(accountConnection.id, request.params.id),
              eq(accountConnection.account_id, viewer.account_id),
            ),
          )
          .returning()

        if (updated === undefined) return sendError(reply, 404)

        return { connection: updated } satisfies ConnectionResponse
      } catch (failure) {
        if (isUniqueViolation(failure)) return sendError(reply, 409)
        throw failure
      }
    },
  )

  app.delete<{ Params: { id: string } }>(
    apiRoutes.removeMyConnection.fastify,
    guarded,
    async (request, reply) => {
      void noStore(reply)

      const viewer = await viewerFor(request, { db, sessions })
      if (viewer === undefined) return sendError(reply, 401)

      const [gone] = await db
        .delete(accountConnection)
        .where(
          and(
            eq(accountConnection.id, request.params.id),
            eq(accountConnection.account_id, viewer.account_id),
          ),
        )
        .returning({ id: accountConnection.id })

      if (gone === undefined) return sendError(reply, 404)

      // Deliberately does not renumber the survivors: `order` only has to sort, not be
      // contiguous — the same call `faq.ts` and `places.ts` make.
      return reply.code(204).send()
    },
  )

  app.put(apiRoutes.reorderMyConnections.fastify, guarded, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(connectionOrderSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return sendError(reply, 401)

    const renumbered = reorder(
      db,
      accountConnection,
      await connectionsFor(db, viewer.account_id),
      body.ids,
      eq(accountConnection.account_id, viewer.account_id),
    )
    if (renumbered === 'mismatch') return sendError(reply, 400)

    return { connections: await connectionsFor(db, viewer.account_id) } satisfies ConnectionsResponse
  })
}
