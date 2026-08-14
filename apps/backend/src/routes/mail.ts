import type { MailSettingsResponse, MailTestResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { apiRoutes, detailsPage, digestPreviewSchema, mailSettingsUpdateSchema } from '@sage-burner/shared'
import { eq } from 'drizzle-orm'

import type { GuardDeps } from '../auth/guards.ts'
import type { Config } from '../config.ts'
import type { MailDeps } from '../mail/mail.ts'

import { viewerFor } from '../auth/viewer.ts'
import { account, installation, INSTALLATION_ID, mailSetting } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { digestPreviewFor } from '../mail/digest.ts'
import { installationTitle, NOT_CONFIGURED, post } from '../mail/mail.ts'
import { absolute, digestMessage, testMessage } from '../mail/messages.ts'

export const NOTHING_TO_PREVIEW = 'Nothing has happened in that stretch, so there is no digest to show you.'

export interface MailRouteDeps extends GuardDeps {
  mail: MailDeps
  now: () => Date
  config: Pick<Config, 'public_origin'>
}

export const registerMailRoutes = (
  app: FastifyInstance,
  { db, sessions, mail, now, config }: MailRouteDeps,
) => {
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

  app.post(apiRoutes.sendDigestPreview.fastify, async (request, reply) => {
    void noStore(reply)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return sendError(reply, 401)

    const body = bodyOf(digestPreviewSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const [who] = await db
      .select({ email: account.email })
      .from(account)
      .where(eq(account.id, viewer.account_id))
      .limit(1)

    if (who === undefined) return sendError(reply, 401)

    if ((await current()) === null) {
      return { sent: false, to: who.email, reason: NOT_CONFIGURED } satisfies MailTestResponse
    }

    const sections = await digestPreviewFor(
      db,
      viewer.account_id,
      { hours: body.hours, origin: config.public_origin },
      now(),
    )

    if (sections.length === 0) {
      return { sent: false, to: who.email, reason: NOTHING_TO_PREVIEW } satisfies MailTestResponse
    }

    const posted = await post(
      mail,
      digestMessage({
        installation: await installationTitle(db),
        to: who.email,
        sections,
        settings: absolute(config.public_origin, detailsPage()),
      }),
    )

    return { sent: posted.sent, to: who.email, reason: posted.reason } satisfies MailTestResponse
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
