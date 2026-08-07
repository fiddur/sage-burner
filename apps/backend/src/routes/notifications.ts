import type { NotificationsResponse, NotificationSettings } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { apiRoutes, notificationCategories, notificationSettingsSchema } from '@sage-burner/shared'
import { eq } from 'drizzle-orm'

import type { GuardDeps } from '../auth/guards.ts'

import { viewerFor } from '../auth/viewer.ts'
import { notificationSetting } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { markSeen, notificationsFor, switchedOn } from '../push/notify.ts'

export interface NotificationDeps extends GuardDeps {
  now?: () => Date
}

/**
 * The bell, and what it is allowed to ring about.
 *
 * Signed in is the whole guard, like passkeys and for the same reason: these are
 * somebody's own records, and an account with no role yet still has some — an
 * applicant whose invite has been reissued, an account holding `admin` alone.
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
    if (accountId === undefined) return sendError(reply, 401)

    return (await notificationsFor(db, accountId)) satisfies NotificationsResponse
  })

  app.post(apiRoutes.markNotificationsSeen.fastify, async (request, reply) => {
    void noStore(reply)

    const accountId = await mine(request)
    if (accountId === undefined) return sendError(reply, 401)

    await markSeen(db, accountId, now())

    // The list back rather than 204: the bell has just changed and the page would
    // otherwise have to ask again to find out what it now looks like.
    return (await notificationsFor(db, accountId)) satisfies NotificationsResponse
  })

  app.get(apiRoutes.getMyNotificationSettings.fastify, async (request, reply) => {
    void noStore(reply)

    const accountId = await mine(request)
    if (accountId === undefined) return sendError(reply, 401)

    return (await switchedOn(db, accountId)) satisfies NotificationSettings
  })

  app.put(apiRoutes.updateMyNotificationSettings.fastify, async (request, reply) => {
    void noStore(reply)

    // Who before what, like the three above: a signed-out caller with a malformed
    // body should hear the same 401 as one with a good body, not a 400 telling them
    // about a route they may not use.
    const accountId = await mine(request)
    if (accountId === undefined) return sendError(reply, 401)

    const body = bodyOf(notificationSettingsSchema, request)
    if (body === undefined) return sendError(reply, 400)

    // The whole set, not a delta — the form sends every tick it is showing, and a
    // delta would need the client to know what it had before to say what changed.
    // Replaced in one transaction so a failure halfway does not leave somebody
    // switched off on categories they just switched back on.
    //
    // A row is written for **every** category, not only the on ones: the body is a
    // complete statement of what this person wants, and storing only half of it
    // would leave the rest reading as "never said" — which is the default, not the
    // choice they just made.
    const on = new Set(body.on)
    const email = new Set(body.email)
    db.transaction((tx) => {
      tx.delete(notificationSetting).where(eq(notificationSetting.account_id, accountId)).run()
      for (const category of notificationCategories) {
        tx.insert(notificationSetting)
          .values({
            account_id: accountId,
            category,
            enabled: on.has(category),
            email: email.has(category),
          })
          .run()
      }
    })

    return {
      on: notificationCategories.filter((category) => on.has(category)),
      email: notificationCategories.filter((category) => email.has(category)),
    } satisfies NotificationSettings
  })
}
