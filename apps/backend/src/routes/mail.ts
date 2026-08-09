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

/**
 * Setting up where this installation posts from, and proving it works (#30).
 *
 * Admin's, under the admin prefix, with no exception — this is a password for
 * somebody else's server and the address every invite will appear to come from.
 *
 * **The read never carries the password.** `has_password` says whether one is
 * stored, and the write treats an absent `password` as "leave what is there": a form
 * that had to re-type it to change the port would end up putting it in a text input
 * on every visit, and a masked value invites a save that stores the mask.
 */
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
      // Absent leaves what is stored — and, on a first save, is empty rather than an
      // error: a relay on the same machine may authenticate by network alone.
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

    // Back to the ordinary state rather than 204: the settings page redraws from
    // this, and "there is no mail server" is the answer it needs.
    return { mail: null } satisfies MailSettingsResponse
  })

  /**
   * A message to the admin's own address.
   *
   * Their own, not one they type: a Send-to box on an admin page is an open relay
   * with extra steps, and the question being answered — do these settings work — is
   * answered just as well by a message to the person asking.
   */
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

    // 200 either way. A refusal by somebody else's SMTP server is an answer to the
    // question the button asked, not a fault in this one — and the page renders the
    // reason, which a 502 would leave it having to dig out of an error envelope.
    return { sent: posted.sent, to: who.email, reason: posted.reason } satisfies MailTestResponse
  })
}
