import type { PushKeyResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { errorResponse, pushSubscriptionCreateSchema } from '@sage-burner/shared'

import type { GuardDeps } from '../auth/guards.ts'
import type { PushDeps } from '../push/push.ts'

import { createGuards } from '../auth/guards.ts'
import { noStore } from '../http.ts'
import { forgetSubscription, rememberSubscription, vapidKeysFor } from '../push/push.ts'
import { viewerFor } from './auth.ts'

export interface PushRouteDeps extends GuardDeps {
  push: PushDeps
}

/**
 * Opting a browser in to notifications, and out again.
 *
 * These lived under `/api/admin/` while the only thing that notified was a new
 * application. Being handed a lead role notifies the person it was handed to
 * (#184), so they **moved out from under the prefix** rather than being exempted
 * inside it — which is the rule, and the reason the hook has no opt-out to forget.
 * `requireApproved` now, so an applicant with an account and no roles still cannot
 * subscribe: there is nothing that would notify them.
 *
 * A subscription is a browser rather than a person, so these are keyed by the
 * endpoint the browser gives us and re-subscribing is an update. `push.ts` says
 * why that matters.
 */
export const registerPushRoutes = (app: FastifyInstance, { db, sessions, push }: PushRouteDeps) => {
  const { requireApproved } = createGuards({ db, sessions })

  /**
   * The key a browser needs before it can subscribe.
   *
   * Minting happens here rather than at boot: an installation that never turns
   * notifications on never acquires a key, which keeps `docker compose up`
   * sufficient and leaves nothing to configure. Behind the guard, so minting is
   * never something a stranger can trigger.
   */
  app.get('/api/push/key', { preHandler: requireApproved }, async (_request, reply) => {
    void noStore(reply)

    const keys = await vapidKeysFor(push)

    return { public_key: keys?.publicKey ?? null } satisfies PushKeyResponse
  })

  app.post('/api/push/subscriptions', { preHandler: requireApproved }, async (request, reply) => {
    void noStore(reply)

    const parsed = pushSubscriptionCreateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

    // The guard has already resolved this, so the viewer is present. Read rather
    // than trusted from the body: whose browser it is follows from the session, so
    // there is no account id to tamper with.
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
   * endpoint is unguessable, one member removing another's is not an escalation,
   * and scoping it would leave a shared laptop's stale row undeletable by the
   * person actually sitting at it.
   */
  app.delete('/api/push/subscriptions', { preHandler: requireApproved }, async (request, reply) => {
    void noStore(reply)

    const parsed = pushSubscriptionCreateSchema.pick({ endpoint: true }).safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

    await forgetSubscription(push, parsed.data.endpoint)

    return reply.code(204).send()
  })
}
