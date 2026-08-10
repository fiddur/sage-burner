import type { NotificationSettings, NotificationsResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { apiRoutes, notificationCategories, notificationSettingsSchema } from '@sage-burner/shared'
import { eq } from 'drizzle-orm'

import type { GuardDeps } from '../auth/guards.ts'

import { viewerFor } from '../auth/viewer.ts'
import { notificationSetting } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { markSeen, notificationsFor, switchedOn } from '../push/notify.ts'

export interface NotificationDeps extends GuardDeps {
  now: () => Date
}

export const registerNotificationRoutes = (app: FastifyInstance, { db, sessions, now }: NotificationDeps) => {
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

    const accountId = await mine(request)
    if (accountId === undefined) return sendError(reply, 401)

    const body = bodyOf(notificationSettingsSchema, request)
    if (body === undefined) return sendError(reply, 400)

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
