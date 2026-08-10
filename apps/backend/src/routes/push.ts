import type { PushKeyResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { apiRoutes, pushSubscriptionCreateSchema } from '@sage-burner/shared'

import type { GuardDeps } from '../auth/guards.ts'
import type { PushDeps } from '../push/push.ts'

import { createGuards } from '../auth/guards.ts'
import { viewerFor } from '../auth/viewer.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { forgetSubscription, rememberSubscription, vapidKeysFor } from '../push/push.ts'

export interface PushRouteDeps extends GuardDeps {
  push: PushDeps
}

export const registerPushRoutes = (app: FastifyInstance, { db, sessions, push }: PushRouteDeps) => {
  const { requireApproved } = createGuards({ db, sessions })

  app.get(apiRoutes.getPushKey.fastify, { preHandler: requireApproved }, async (_request, reply) => {
    void noStore(reply)

    const keys = await vapidKeysFor(push)

    return { public_key: keys?.publicKey ?? null } satisfies PushKeyResponse
  })

  app.post(apiRoutes.subscribeToPush.fastify, { preHandler: requireApproved }, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(pushSubscriptionCreateSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return sendError(reply, 401)

    await rememberSubscription(push, viewer.account_id, body)

    return reply.code(204).send()
  })

  app.delete(
    apiRoutes.unsubscribeFromPush.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const parsed = pushSubscriptionCreateSchema.pick({ endpoint: true }).safeParse(request.body)
      if (!parsed.success) return sendError(reply, 400)

      await forgetSubscription(push, parsed.data.endpoint)

      return reply.code(204).send()
    },
  )
}
