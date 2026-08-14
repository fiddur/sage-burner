import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createDb, runMigrations } from '../db/index.ts'
import { account } from '../db/schema.ts'
import { ACTIVE_EVERY_MS, markActive } from './active.ts'

const NOW = new Date('2026-08-14T12:00:00.000Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()

let handle: DbHandle | undefined

afterEach(() => {
  handle?.close()
  handle = undefined
})

const db = () => {
  const found = handle?.db
  if (found === undefined) throw new Error('build() first')

  return found
}

const givenAccount = async (lastActive: string | null) => {
  handle = createDb({ url: ':memory:' })
  runMigrations(handle)

  const id = randomUUID()
  await db()
    .insert(account)
    .values({
      id,
      email: `${id}@example.org`,
      password_hash: null,
      created_at: ago(30 * ACTIVE_EVERY_MS),
      last_active_at: lastActive,
    })

  return id
}

const stampOn = async (accountId: string) => {
  const [row] = await db()
    .select({ at: account.last_active_at })
    .from(account)
    .where(eq(account.id, accountId))
    .limit(1)

  return row?.at ?? null
}

describe('recording that somebody has been here', () => {
  it('stamps an account that has never been seen', async () => {
    const accountId = await givenAccount(null)

    await markActive(db(), accountId, NOW)

    expect(await stampOn(accountId)).toBe(NOW.toISOString())
  })

  it('stamps one whose last visit is older than the hour', async () => {
    const accountId = await givenAccount(ago(ACTIVE_EVERY_MS + 1000))

    await markActive(db(), accountId, NOW)

    expect(await stampOn(accountId)).toBe(NOW.toISOString())
  })

  it('leaves one seen inside the hour alone, which is what makes it free per request', async () => {
    const recent = ago(ACTIVE_EVERY_MS / 2)
    const accountId = await givenAccount(recent)

    await markActive(db(), accountId, NOW)

    expect(await stampOn(accountId)).toBe(recent)
  })

  it('touches nobody else', async () => {
    const accountId = await givenAccount(null)
    const other = randomUUID()
    await db()
      .insert(account)
      .values({ id: other, email: `${other}@example.org`, password_hash: null, created_at: ago(1000) })

    await markActive(db(), accountId, NOW)

    const [row] = await db().select({ at: account.last_active_at }).from(account).limit(1)
    expect(row?.at).toBe(NOW.toISOString())
    expect(
      (await db().select({ id: account.id, at: account.last_active_at }).from(account)).find(
        (one) => one.id === other,
      )?.at,
    ).toBeNull()
  })
})
