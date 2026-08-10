import type { OAuthProvider } from '@sage-burner/shared'

import { and, asc, eq, ne } from 'drizzle-orm'

import type { Database } from '../db/index.ts'

import { oauthSetting } from '../db/schema.ts'

export const oauthSettingFor = async (db: Database, provider: OAuthProvider) => {
  const [row] = await db.select().from(oauthSetting).where(eq(oauthSetting.provider, provider)).limit(1)

  return row
}

const usable = (row: { client_id: string; client_secret: string }) =>
  row.client_id !== '' && row.client_secret !== ''

export const usableOauthSetting = async (db: Database, provider: OAuthProvider) => {
  const row = await oauthSettingFor(db, provider)

  return row === undefined || !usable(row) ? undefined : row
}

export const configuredProviders = async (db: Database): Promise<OAuthProvider[]> => {
  const rows = await db
    .select({ provider: oauthSetting.provider })
    .from(oauthSetting)
    .where(and(ne(oauthSetting.client_id, ''), ne(oauthSetting.client_secret, '')))
    .orderBy(asc(oauthSetting.provider))

  return rows.map((row) => row.provider)
}
