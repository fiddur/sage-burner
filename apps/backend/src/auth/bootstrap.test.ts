import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createDb, runMigrations } from '../db/index.ts'
import { account, accountConnection, accountRole } from '../db/schema.ts'
import { ensureAdmin } from './bootstrap.ts'
import { verifyPassword } from './password.ts'

const cheap = { cost: 2 ** 12, blockSize: 8, parallelism: 1 }

let handle: DbHandle | undefined

afterEach(() => {
  handle?.close()
  handle = undefined
})

const database = () => {
  handle = createDb({ url: ':memory:' })
  runMigrations(handle)
  return handle.db
}

const rolesOf = async (db: ReturnType<typeof database>, accountId: string) => {
  const rows = await db.select().from(accountRole).where(eq(accountRole.account_id, accountId))
  return rows.map((row) => row.role).sort()
}

describe('ensureAdmin', () => {
  it('creates an admin with a usable password', async () => {
    const db = database()

    const result = await ensureAdmin({
      db,
      email: 'ada@example.org',
      password: 'a good long passphrase',
      params: cheap,
    })

    expect(result.created).toBe(true)
    expect(await rolesOf(db, result.account_id)).toEqual(['admin', 'member'])

    const [row] = await db.select().from(account).where(eq(account.id, result.account_id))
    await expect(verifyPassword('a good long passphrase', row?.password_hash ?? null)).resolves.toBe(true)
  })

  it('is safe to run twice', async () => {
    // A deploy script or a confused operator will do this. The second run must
    // not fail on the primary key, and must not create a second account.
    const db = database()
    const first = await ensureAdmin({
      db,
      email: 'ada@example.org',
      password: 'a good long passphrase',
      params: cheap,
    })

    const second = await ensureAdmin({
      db,
      email: 'ada@example.org',
      password: 'a good long passphrase',
      params: cheap,
    })

    expect(second).toEqual({ account_id: first.account_id, created: false })
    expect(await rolesOf(db, first.account_id)).toEqual(['admin', 'member'])
    expect(await db.select().from(account)).toHaveLength(1)
  })

  it('gives the account it creates its login address as a way to be reached', async () => {
    const db = database()

    const { account_id } = await ensureAdmin({
      db,
      email: 'ada@example.org',
      password: 'a good long passphrase',
      params: cheap,
    })

    const held = await db.select().from(accountConnection).where(eq(accountConnection.account_id, account_id))

    expect(held).toHaveLength(1)
    expect(held[0]).toMatchObject({ kind: 'email', value: 'ada@example.org', order: 0 })
  })

  it('adds nothing to an account that already exists, whatever it took off', async () => {
    // Re-running the bootstrap grants roles and stops. Putting the address back would undo
    // a deletion the person meant, and this command is run again whenever an operator is
    // unsure whether the admin exists.
    const db = database()
    await db.insert(account).values({
      id: 'existing',
      email: 'ada@example.org',
      password_hash: null,
      created_at: '2026-01-01T00:00:00.000Z',
    })

    await ensureAdmin({ db, email: 'ada@example.org', password: 'a good long passphrase', params: cheap })

    expect(await db.select().from(accountConnection)).toEqual([])
  })

  it('grants the roles to an account that already exists', async () => {
    const db = database()
    await db.insert(account).values({
      id: 'existing',
      email: 'ada@example.org',
      password_hash: null,
      created_at: '2026-01-01T00:00:00.000Z',
    })

    const result = await ensureAdmin({
      db,
      email: 'ada@example.org',
      password: 'a good long passphrase',
      params: cheap,
    })

    expect(result).toEqual({ account_id: 'existing', created: false })
    expect(await rolesOf(db, 'existing')).toEqual(['admin', 'member'])
  })

  it('never changes an existing password', async () => {
    // Otherwise the bootstrap command is an offline password reset for any
    // account, and anyone who can run it can take over the admin's login.
    const db = database()
    const first = await ensureAdmin({
      db,
      email: 'ada@example.org',
      password: 'the original one',
      params: cheap,
    })

    await ensureAdmin({ db, email: 'ada@example.org', password: 'an attacker choice', params: cheap })

    const [row] = await db.select().from(account).where(eq(account.id, first.account_id))
    await expect(verifyPassword('the original one', row?.password_hash ?? null)).resolves.toBe(true)
    await expect(verifyPassword('an attacker choice', row?.password_hash ?? null)).resolves.toBe(false)
  })

  it('matches an existing account case-insensitively', async () => {
    // The account table's UNIQUE is BINARY, so without normalising here the
    // admin gets a second account rather than the role they asked for.
    const db = database()
    const first = await ensureAdmin({
      db,
      email: 'ada@example.org',
      password: 'a good long passphrase',
      params: cheap,
    })

    const second = await ensureAdmin({
      db,
      email: '  Ada@Example.ORG ',
      password: 'a good long passphrase',
      params: cheap,
    })

    expect(second.account_id).toBe(first.account_id)
    expect(await db.select().from(account)).toHaveLength(1)
  })

  it('takes any password that is a password at all', async () => {
    const db = database()

    await expect(
      ensureAdmin({ db, email: 'ada@example.org', password: 'hi', params: cheap }),
    ).resolves.toMatchObject({ created: true })
  })

  it('rejects an empty password, which is not one', async () => {
    const db = database()

    await expect(ensureAdmin({ db, email: 'ada@example.org', password: '', params: cheap })).rejects.toThrow(
      /ADMIN_PASSWORD is empty/,
    )
    expect(await db.select().from(account)).toHaveLength(0)
  })

  it('rejects an address that is not one', async () => {
    const db = database()

    await expect(
      ensureAdmin({ db, email: 'not-an-email', password: 'a good long passphrase', params: cheap }),
    ).rejects.toThrow(/valid email/)
  })

  it('still grants the roles when the password would be refused', async () => {
    // The password rule guards a password being *set*. Refusing to grant a role
    // over it would fail for a reason that has nothing to do with the request.
    const db = database()
    const first = await ensureAdmin({
      db,
      email: 'ada@example.org',
      password: 'a good long passphrase',
      params: cheap,
    })
    await db.delete(accountRole).where(eq(accountRole.account_id, first.account_id))

    const second = await ensureAdmin({ db, email: 'ada@example.org', password: 'x', params: cheap })

    expect(second.created).toBe(false)
    expect(await rolesOf(db, first.account_id)).toEqual(['admin', 'member'])
  })
})
