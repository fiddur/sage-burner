import type { OAuthSettings, OAuthSettingsResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { apiRoutes, isOAuthProvider, oauthSettingsUpdateSchema } from '@sage-burner/shared'
import { eq } from 'drizzle-orm'

import type { Database } from '../db/index.ts'

import { oauthSetting } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { oauthSettingFor } from '../oauth/settings.ts'

export interface OAuthAdminDeps {
  db: Database
  now: () => Date
}

/**
 * Setting up a provider, for the admin who has an app registered with it (#393).
 *
 * Under `/api/admin/`, so the prefix hook is the only authorization and there is no
 * per-route opt-out to forget. `mail_setting`'s routes are the pattern in every respect,
 * including the one that matters: **the secret never comes back out.** The read answers
 * `has_secret`, and a save that omits the field keeps what is stored — so correcting a typo
 * in the client id does not need the secret typed again, and a form does not hold it in an
 * input on every visit.
 */
export const registerOauthAdminRoutes = (app: FastifyInstance, { db, now }: OAuthAdminDeps) => {
  const current = async (provider: string): Promise<OAuthSettings | null> => {
    if (!isOAuthProvider(provider)) return null

    const row = await oauthSettingFor(db, provider)
    if (row === undefined) return null

    // The destructure is the whole mechanism: the secret is not in the object that leaves.
    const { client_secret, ...rest } = row

    return { ...rest, has_secret: client_secret !== '' }
  }

  app.get<{ Params: { provider: string } }>(apiRoutes.getOauthSettings.fastify, async (request, reply) => {
    void noStore(reply)

    if (!isOAuthProvider(request.params.provider)) return sendError(reply, 404)

    return { settings: await current(request.params.provider) } satisfies OAuthSettingsResponse
  })

  app.put<{ Params: { provider: string } }>(apiRoutes.updateOauthSettings.fastify, async (request, reply) => {
    void noStore(reply)

    const { provider } = request.params
    if (!isOAuthProvider(provider)) return sendError(reply, 404)

    const body = bodyOf(oauthSettingsUpdateSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const held = await oauthSettingFor(db, provider)
    const row = {
      provider,
      client_id: body.client_id,
      // Absent keeps what is stored; empty clears it. Written out here rather than
      // inferred, because "keep" and "clear" being the same value is the mistake this
      // shape exists to prevent.
      client_secret: body.client_secret ?? held?.client_secret ?? '',
      ask_profile_link: body.ask_profile_link ?? held?.ask_profile_link ?? false,
      updated_at: now().toISOString(),
    }

    await db.insert(oauthSetting).values(row).onConflictDoUpdate({ target: oauthSetting.provider, set: row })

    return { settings: await current(provider) } satisfies OAuthSettingsResponse
  })

  app.delete<{ Params: { provider: string } }>(
    apiRoutes.removeOauthSettings.fastify,
    async (request, reply) => {
      void noStore(reply)

      const { provider } = request.params
      if (!isOAuthProvider(provider)) return sendError(reply, 404)

      await db.delete(oauthSetting).where(eq(oauthSetting.provider, provider))

      // `{ settings: null }` rather than 204, so the page can redraw from the answer —
      // `removeMailSettings` for the same reason. Turning a provider off takes the button
      // off the login page, since `social_logins` is what has been configured.
      return { settings: null } satisfies OAuthSettingsResponse
    },
  )
}
