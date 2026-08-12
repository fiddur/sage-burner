import { emailSchema, MIN_PASSWORD, newPasswordSchema } from '@sage-burner/shared'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { Database } from '../db/index.ts'
import type { ScryptParams } from './password.ts'

import { loginAddressConnection } from '../connections.ts'
import { account, accountConnection, accountRole } from '../db/schema.ts'
import { defaultScryptParams, hashPassword } from './password.ts'

const BOOTSTRAP_ROLES = ['admin', 'member'] as const

export interface EnsureAdminInput {
  db: Database
  email: string
  password: string
  params?: ScryptParams
  now?: () => Date
  newId?: () => string
}

export interface EnsureAdminResult {
  account_id: string
  created: boolean
}

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

  if (!newPasswordSchema.safeParse(password).success) {
    throw new Error(`ADMIN_PASSWORD needs at least ${MIN_PASSWORD} characters.`)
  }

  const id = newId()
  await db.insert(account).values({
    id,
    email: parsedEmail.data,
    password_hash: await hashPassword(password, params),
    created_at: now().toISOString(),
  })
  await db.insert(accountRole).values(BOOTSTRAP_ROLES.map((role) => ({ account_id: id, role })))
  await db.insert(accountConnection).values(loginAddressConnection(id, parsedEmail.data))

  return { account_id: id, created: true }
}
