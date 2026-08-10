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

export const registerOauthAdminRoutes = (app: FastifyInstance, { db, now }: OAuthAdminDeps) => {
  const current = async (provider: string): Promise<OAuthSettings | null> => {
    if (!isOAuthProvider(provider)) return null

    const row = await oauthSettingFor(db, provider)
    if (row === undefined) return null

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

      return { settings: null } satisfies OAuthSettingsResponse
    },
  )
}
