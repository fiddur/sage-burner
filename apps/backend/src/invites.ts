import { count, eq } from 'drizzle-orm'
import { createHash, randomBytes } from 'node:crypto'

import type { Database } from './db/client.ts'

import { inviteRedemption } from './db/schema.ts'

const INVITE_TOKEN_BYTES = 32

export const INVITE_VALID_DAYS = 30

export const digestOf = (token: string) => createHash('sha256').update(token).digest('hex')

export const mintToken = () => {
  const token = randomBytes(INVITE_TOKEN_BYTES).toString('base64url')

  return { token, token_hash: digestOf(token) }
}

export const defaultExpiry = (now: Date) =>
  new Date(now.getTime() + INVITE_VALID_DAYS * 24 * 60 * 60 * 1000).toISOString()

export const redemptionsOf = async (db: Database, tokenId: string): Promise<number> => {
  const [tally] = await db
    .select({ taken: count() })
    .from(inviteRedemption)
    .where(eq(inviteRedemption.token_id, tokenId))

  return tally?.taken ?? 0
}
