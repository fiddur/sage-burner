import type { PushKeyResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { errorResponse, pushSubscriptionCreateSchema } from '@sage-burner/shared'

import type { GuardDeps } from '../auth/guards.ts'
import type { PushDeps } from '../push/push.ts'

import { noStore } from '../http.ts'
import { forgetSubscription, rememberSubscription, vapidKeysFor } from '../push/push.ts'
import { viewerFor } from './auth.ts'

export interface PushRouteDeps extends GuardDeps {
  push: PushDeps
}

/**
 * Opting a browser in to notifications, and out again.
 *
 * Admin-only, because the only thing that notifies today is a new application and
 * only admins can act on one. Under `/api/admin/` so the prefix hook decides that
 * rather than each route remembering — when a member-facing notification arrives,
 * that is the moment to move these, not to loosen them here.
 *
 * A subscription is a browser rather than a person, so these are keyed by the
 * endpoint the browser gives us and re-subscribing is an update. `push.ts` says
 * why that matters.
 */
export const registerPushRoutes = (app: FastifyInstance, { db, sessions, push }: PushRouteDeps) => {
  /**
   * The key a browser needs before it can subscribe.
   *
   * Minting happens here rather than at boot: an installation that never turns
   * notifications on never acquires a key, which keeps `docker compose up`
   * sufficient and leaves nothing to configure. Admin-only, so being asked is
   * never something a stranger can trigger.
   */
  app.get('/api/admin/push/key', async (_request, reply) => {
    void noStore(reply)

    const keys = await vapidKeysFor(push)

    return { public_key: keys?.publicKey ?? null } satisfies PushKeyResponse
  })

  app.post('/api/admin/push/subscriptions', async (request, reply) => {
    void noStore(reply)

    const parsed = pushSubscriptionCreateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

    // The prefix hook has already resolved this, so the viewer is present. Read
    // rather than trusted from the body: whose browser it is follows from the
    // session, so there is no account id to tamper with.
    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return reply.code(401).send(errorResponse('unauthenticated'))

    await rememberSubscription(push, viewer.account_id, parsed.data)

    return reply.code(204).send()
  })

  /**
   * Unsubscribing, by endpoint rather than by session.
   *
   * A browser that has revoked permission still knows its old endpoint and should
   * be able to clear the row. Not scoped to the viewer's own subscriptions: an
   * endpoint is unguessable, an admin removing one is not a privilege escalation,
   * and scoping it would leave a shared laptop's stale row undeletable by the
   * person actually sitting at it.
   */
  app.delete('/api/admin/push/subscriptions', async (request, reply) => {
    void noStore(reply)

    const parsed = pushSubscriptionCreateSchema.pick({ endpoint: true }).safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

    await forgetSubscription(push, parsed.data.endpoint)

    return reply.code(204).send()
  })
}
