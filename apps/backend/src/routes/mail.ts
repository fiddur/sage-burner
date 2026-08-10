import type { MailSettingsResponse, MailTestResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { apiRoutes, mailSettingsUpdateSchema } from '@sage-burner/shared'
import { eq } from 'drizzle-orm'

import type { GuardDeps } from '../auth/guards.ts'
import type { MailDeps } from '../mail/mail.ts'

import { viewerFor } from '../auth/viewer.ts'
import { account, installation, INSTALLATION_ID, mailSetting } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { NOT_CONFIGURED, post } from '../mail/mail.ts'
import { testMessage } from '../mail/messages.ts'

export interface MailRouteDeps extends GuardDeps {
  mail: MailDeps
  now: () => Date
}

export const registerMailRoutes = (app: FastifyInstance, { db, sessions, mail, now }: MailRouteDeps) => {
  const current = async (): Promise<MailSettingsResponse['mail']> => {
    const [row] = await db.select().from(mailSetting).where(eq(mailSetting.id, INSTALLATION_ID)).limit(1)

    if (row === undefined) return null

    const { password, id: _id, ...rest } = row

    return { ...rest, has_password: password !== '' }
  }

  app.get(apiRoutes.getMailSettings.fastify, async (_request, reply) => {
    void noStore(reply)

    return { mail: await current() } satisfies MailSettingsResponse
  })

  app.put(apiRoutes.updateMailSettings.fastify, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(mailSettingsUpdateSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const { password, ...settings } = body
    const [held] = await db
      .select({ password: mailSetting.password })
      .from(mailSetting)
      .where(eq(mailSetting.id, INSTALLATION_ID))
      .limit(1)

    const row = {
      ...settings,
      password: password ?? held?.password ?? '',
      updated_at: now().toISOString(),
    }

    await db
      .insert(mailSetting)
      .values({ id: INSTALLATION_ID, ...row })
      .onConflictDoUpdate({ target: mailSetting.id, set: row })

    return { mail: await current() } satisfies MailSettingsResponse
  })

  app.delete(apiRoutes.removeMailSettings.fastify, async (_request, reply) => {
    void noStore(reply)

    await db.delete(mailSetting).where(eq(mailSetting.id, INSTALLATION_ID))

    return { mail: null } satisfies MailSettingsResponse
  })

  app.post(apiRoutes.sendTestEmail.fastify, async (request, reply) => {
    void noStore(reply)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return sendError(reply, 401)

    const [who] = await db
      .select({ email: account.email })
      .from(account)
      .where(eq(account.id, viewer.account_id))
      .limit(1)

    if (who === undefined) return sendError(reply, 401)

    const [named] = await db
      .select({ title: installation.title })
      .from(installation)
      .where(eq(installation.id, INSTALLATION_ID))
      .limit(1)

    const settings = await current()
    if (settings === null) {
      return { sent: false, to: who.email, reason: NOT_CONFIGURED } satisfies MailTestResponse
    }

    const posted = await post(mail, testMessage({ installation: named?.title ?? '', to: who.email }))

    return { sent: posted.sent, to: who.email, reason: posted.reason } satisfies MailTestResponse
  })
}
