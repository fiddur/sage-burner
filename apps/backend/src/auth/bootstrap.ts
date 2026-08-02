import { emailSchema, newPasswordSchema } from '@sage-burner/shared'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { Database } from '../db/index.ts'
import type { ScryptParams } from './password.ts'

import { account, accountRole } from '../db/schema.ts'
import { defaultScryptParams, hashPassword } from './password.ts'

const BOOTSTRAP_ROLES = ['admin', 'member'] as const

export interface EnsureAdminInput {
  db: Database
  email: string
  password: string
  /** Injected so tests can hash cheaply. */
  params?: ScryptParams
  now?: () => Date
  newId?: () => string
}

export interface EnsureAdminResult {
  account_id: string
  /** False when the account already existed and was only granted the role. */
  created: boolean
}

/**
 * Make sure an admin exists, so a fresh deploy has someone who can approve
 * anything.
 *
 * Grants `member` alongside `admin`. The roles stay separate concepts — an
 * organiser who is not attending is coherent — but `member` is what gates a
 * person's own profile and saying they are coming, so admin alone left the
 * account every installation starts with unable to use half the app, with no
 * way to fix it from inside (#110). Granting both is the ordinary case; the
 * accounts list is where either is taken away.
 *
 * **Never touches an existing account's password.** If the address is already
 * here, this grants the roles and stops. Otherwise the bootstrap command would
 * double as an offline password reset for any account — anyone who can run it
 * could take over the organiser's login rather than merely create one, and the
 * operator running it a second time with a different password would think it
 * had changed when it had not. Granting is idempotent; resetting would not be.
 *
 * Throws on invalid input rather than returning a result, because the only
 * caller is a CLI whose failure mode is "print it and exit non-zero".
 */
export const ensureAdmin = async ({
  db,
  email,
  password,
  params = defaultScryptParams,
  now = () => new Date(),
  newId = randomUUID,
}: EnsureAdminInput): Promise<EnsureAdminResult> => {
  const parsedEmail = emailSchema.safeParse(email)
  if (!parsedEmail.success) throw new Error(`Not a valid email address: ${email}`)

  const [existing] = await db
    .select({ id: account.id })
    .from(account)
    .where(eq(account.email, parsedEmail.data))
    .limit(1)

  if (existing !== undefined) {
    await db
      .insert(accountRole)
      .values(BOOTSTRAP_ROLES.map((role) => ({ account_id: existing.id, role })))
      .onConflictDoNothing()
    return { account_id: existing.id, created: false }
  }

  // Checked only on the branch that uses it: refusing over the password while
  // merely granting a role to an existing account would refuse to do something
  // the password has no part in.
  if (!newPasswordSchema.safeParse(password).success) {
    throw new Error('Set a password — ADMIN_PASSWORD is empty.')
  }

  const id = newId()
  await db.insert(account).values({
    id,
    email: parsedEmail.data,
    password_hash: await hashPassword(password, params),
    created_at: now().toISOString(),
  })
  await db.insert(accountRole).values(BOOTSTRAP_ROLES.map((role) => ({ account_id: id, role })))

  return { account_id: id, created: true }
}
