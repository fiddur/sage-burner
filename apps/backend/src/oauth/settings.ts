import type { OAuthProvider } from '@sage-burner/shared'

import { and, asc, eq, ne } from 'drizzle-orm'

import type { Database } from '../db/index.ts'

import { oauthSetting } from '../db/schema.ts'

/** What one provider was configured with, or nothing — which is the ordinary state. */
export const oauthSettingFor = async (db: Database, provider: OAuthProvider) => {
  const [row] = await db.select().from(oauthSetting).where(eq(oauthSetting.provider, provider)).limit(1)

  return row
}

/** Both halves filled in, which is what a round trip needs and what draws a button. */
const usable = (row: { client_id: string; client_secret: string }) =>
  row.client_id !== '' && row.client_secret !== ''

/**
 * The settings a round trip can actually be made with.
 *
 * `oauthSettingFor` answers the row as stored, which the admin page needs to say
 * `has_secret`. Starting or finishing a trip needs both halves — the same rule
 * `configuredProviders` draws the button by, so the button and the trip agree.
 */
export const usableOauthSetting = async (db: Database, provider: OAuthProvider) => {
  const row = await oauthSettingFor(db, provider)

  return row === undefined || !usable(row) ? undefined : row
}

/**
 * Which providers somebody may sign in from.
 *
 * Read by the **public** installation route, so the login page can draw its buttons before
 * anybody is signed in — a provider that is not configured is absent rather than present
 * and disabled. Only the provider names leave this function; not the ids, and certainly
 * not the secrets.
 *
 * **On a secret rather than on the row existing.** The secret is optional on the update, so
 * a save that leaves it blank — a first one, or one clearing it — keeps a row with
 * `client_secret = ''`. Selected on existence, that drew "Continue with Discord" for a trip
 * that can only end at `/login?from=refused`, which is the "a button that cannot work reads
 * as a promise" this feature otherwise honours.
 */
export const configuredProviders = async (db: Database): Promise<OAuthProvider[]> => {
  const rows = await db
    .select({ provider: oauthSetting.provider })
    .from(oauthSetting)
    .where(and(ne(oauthSetting.client_id, ''), ne(oauthSetting.client_secret, '')))
    .orderBy(asc(oauthSetting.provider))

  return rows.map((row) => row.provider)
}
