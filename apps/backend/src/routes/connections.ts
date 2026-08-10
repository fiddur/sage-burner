import type { Connection, ConnectionResponse, ConnectionsResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import {
  apiRoutes,
  connectionCreateSchema,
  connectionOrderSchema,
  connectionUpdateSchema,
  connectionValue,
  errorResponse,
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

export const connectionsFor = async (db: Database, accountId: string): Promise<Connection[]> =>
  await db
    .select({
      id: accountConnection.id,
      account_id: accountConnection.account_id,
      kind: accountConnection.kind,
      value: accountConnection.value,
      label: accountConnection.label,
      order: accountConnection.order,
    })
    .from(accountConnection)
    .where(eq(accountConnection.account_id, accountId))
    .orderBy(asc(accountConnection.order), asc(accountConnection.id))

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
    if (held.length >= MAX_CONNECTIONS) return reply.code(409).send(errorResponse('list_full'))

    const row = { ...body, value: connectionValue(body.kind, body.value) }

    if (row.value === '') return sendError(reply, 400)

    const id = randomUUID()

    try {
      const order = db.transaction((tx) => {
        const next = nextOrder(tx, accountConnection, eq(accountConnection.account_id, viewer.account_id))
        tx.insert(accountConnection)
          .values({ ...row, id, account_id: viewer.account_id, order: next })
          .run()

        return next
      })

      return reply.code(201).send({
        connection: { ...row, id, account_id: viewer.account_id, order },
      } satisfies ConnectionResponse)
    } catch (failure) {
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

      const value = connectionValue(body.kind, body.value)
      if (value === '') return sendError(reply, 400)

      try {
        const [updated] = await db
          .update(accountConnection)
          .set({ ...body, value, from_provider: null })
          .where(
            and(
              eq(accountConnection.id, request.params.id),
              eq(accountConnection.account_id, viewer.account_id),
            ),
          )
          .returning({
            id: accountConnection.id,
            account_id: accountConnection.account_id,
            kind: accountConnection.kind,
            value: accountConnection.value,
            label: accountConnection.label,
            order: accountConnection.order,
          })

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
