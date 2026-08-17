import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole } from '../db/schema.ts'
import { createSessions } from './session.ts'
import { SESSION_COOKIE, viewerFor } from './viewer.ts'

const SECRET = 's'.repeat(40)
const NOW = '2026-08-05T00:00:00.000Z'

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

const build = () => {
  handle = createDb({ url: ':memory:' })
  runMigrations(handle)
  return { db: db(), sessions: createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 }) }
}

const givenAccount = async (deps: ReturnType<typeof build>, roles: ('admin' | 'member')[] = ['member']) => {
  const id = randomUUID()
  await deps.db
    .insert(account)
    .values({ id, email: `${id}@example.org`, password_hash: null, name: 'Ada', created_at: NOW })
  for (const role of roles) await deps.db.insert(accountRole).values({ account_id: id, role })

  return { id, headers: { cookie: `${SESSION_COOKIE}=${deps.sessions.issue(id)}` } }
}

describe('viewerFor', () => {
  it('answers a second ask from the first, without going back to the database', async () => {
    const deps = build()
    const ada = await givenAccount(deps)

    const first = await viewerFor(ada, deps)

    await deps.db.delete(accountRole).where(eq(accountRole.account_id, ada.id))
    await deps.db.delete(account).where(eq(account.id, ada.id))

    expect(await viewerFor(ada, deps)).toEqual(first)
    expect(first?.roles).toEqual(['member'])
  })

  it('asks again for a different request, so the cache is per request and not per token', async () => {
    const deps = build()
    const ada = await givenAccount(deps)
    await viewerFor(ada, deps)

    await deps.db.delete(accountRole).where(eq(accountRole.account_id, ada.id))

    const later = await viewerFor({ headers: { ...ada.headers } }, deps)

    expect(later?.roles).toEqual([])
  })

  it('remembers that nobody is signed in, rather than asking again', async () => {
    const deps = build()
    const ada = await givenAccount(deps)
    await deps.db.delete(accountRole).where(eq(accountRole.account_id, ada.id))
    await deps.db.delete(account).where(eq(account.id, ada.id))

    expect(await viewerFor(ada, deps)).toBeUndefined()

    await deps.db
      .insert(account)
      .values({ id: ada.id, email: 'back@example.org', password_hash: null, created_at: NOW })

    expect(await viewerFor(ada, deps)).toBeUndefined()
  })

  it('answers undefined for a token whose account has since been deleted', async () => {
    const deps = build()
    const ada = await givenAccount(deps)
    await deps.db.delete(accountRole).where(eq(accountRole.account_id, ada.id))
    await deps.db.delete(account).where(eq(account.id, ada.id))

    expect(await viewerFor({ headers: { ...ada.headers } }, deps)).toBeUndefined()
  })
})
