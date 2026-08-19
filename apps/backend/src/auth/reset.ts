import type { ResetStatus } from '@sage-burner/shared'

import { RESET_VALID_HOURS } from '@sage-burner/shared'
import { eq } from 'drizzle-orm'

import type { Transaction } from '../db/client.ts'

import { passwordReset } from '../db/schema.ts'

export const resetExpiry = (now: Date): string =>
  new Date(now.getTime() + RESET_VALID_HOURS * 60 * 60 * 1000).toISOString()

export const resetStatusOf = (held: { expires_at: string } | undefined, now: Date): ResetStatus => {
  if (held === undefined) return 'unknown'

  return Date.parse(held.expires_at) <= now.getTime() ? 'expired' : 'outstanding'
}

export const dropResets = (tx: Transaction, accountId: string): void => {
  tx.delete(passwordReset).where(eq(passwordReset.account_id, accountId)).run()
}
