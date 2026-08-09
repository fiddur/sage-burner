import type { OAuthProvider } from '@sage-burner/shared'

import { asc, eq } from 'drizzle-orm'

import type { Database } from '../db/index.ts'

import { oauthSetting } from '../db/schema.ts'

/** What one provider was configured with, or nothing — which is the ordinary state. */
export const oauthSettingFor = async (db: Database, provider: OAuthProvider) => {
  const [row] = await db.select().from(oauthSetting).where(eq(oauthSetting.provider, provider)).limit(1)

  return row
}

/**
 * Which providers somebody may sign in from.
 *
 * Read by the **public** installation route, so the login page can draw its buttons before
 * anybody is signed in — a provider that is not configured is absent rather than present
 * and disabled. Only the provider names leave this function; not the ids, and certainly
 * not the secrets.
 */
export const configuredProviders = async (db: Database): Promise<OAuthProvider[]> => {
  const rows = await db
    .select({ provider: oauthSetting.provider })
    .from(oauthSetting)
    .orderBy(asc(oauthSetting.provider))

  return rows.map((row) => row.provider)
}
