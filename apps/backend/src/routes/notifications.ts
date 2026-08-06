import type { NotificationsResponse, NotificationSettings } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { apiRoutes, errorResponse, notificationSettingsSchema } from '@sage-burner/shared'
import { eq } from 'drizzle-orm'

import type { GuardDeps } from '../auth/guards.ts'

import { viewerFor } from '../auth/viewer.ts'
import { notificationMute } from '../db/schema.ts'
import { noStore } from '../http.ts'
import { markSeen, notificationsFor } from '../push/notify.ts'

export interface NotificationDeps extends GuardDeps {
  now?: () => Date
}

/**
 * The bell, and what it is allowed to ring about.
 *
 * Signed in is the whole guard, like passkeys and for the same reason: these are
 * somebody's own records, and an account with no role yet still has some — an
 * applicant whose invite has been reissued, an organiser holding `admin` alone.
 * Every route derives whose they are from the session, so there is no id in any
 * path to get wrong or to tamper with.
 */
export const registerNotificationRoutes = (
  app: FastifyInstance,
  { db, sessions, now = () => new Date() }: NotificationDeps,
) => {
  const mine = async (request: Parameters<typeof viewerFor>[0]) =>
    (await viewerFor(request, { db, sessions }))?.account_id

  app.get(apiRoutes.getMyNotifications.fastify, async (request, reply) => {
    void noStore(reply)

    const accountId = await mine(request)
    if (accountId === undefined) return reply.code(401).send(errorResponse('unauthenticated'))

    return (await notificationsFor(db, accountId)) satisfies NotificationsResponse
  })

  app.post(apiRoutes.markNotificationsSeen.fastify, async (request, reply) => {
    void noStore(reply)

    const accountId = await mine(request)
    if (accountId === undefined) return reply.code(401).send(errorResponse('unauthenticated'))

    await markSeen(db, accountId, now())

    // The list back rather than 204: the bell has just changed and the page would
    // otherwise have to ask again to find out what it now looks like.
    return (await notificationsFor(db, accountId)) satisfies NotificationsResponse
  })

  app.get(apiRoutes.getMyNotificationSettings.fastify, async (request, reply) => {
    void noStore(reply)

    const accountId = await mine(request)
    if (accountId === undefined) return reply.code(401).send(errorResponse('unauthenticated'))

    const rows = await db
      .select({ category: notificationMute.category })
      .from(notificationMute)
      .where(eq(notificationMute.account_id, accountId))

    return { muted: rows.map((row) => row.category) } satisfies NotificationSettings
  })

  app.put(apiRoutes.updateMyNotificationSettings.fastify, async (request, reply) => {
    void noStore(reply)

    const parsed = notificationSettingsSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

    const accountId = await mine(request)
    if (accountId === undefined) return reply.code(401).send(errorResponse('unauthenticated'))

    // The whole set, not a delta — the form sends every tick it is showing, and a
    // delta would need the client to know what it had before to say what changed.
    // Replaced in one transaction so a failure halfway does not leave somebody muted
    // on categories they just switched back on.
    const wanted = [...new Set(parsed.data.muted)]
    db.transaction((tx) => {
      tx.delete(notificationMute).where(eq(notificationMute.account_id, accountId)).run()
      for (const category of wanted) {
        tx.insert(notificationMute).values({ account_id: accountId, category }).run()
      }
    })

    return { muted: wanted } satisfies NotificationSettings
  })
}
