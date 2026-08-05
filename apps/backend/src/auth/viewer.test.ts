import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole } from '../db/schema.ts'
import { createSessions } from './session.ts'
import { SESSION_COOKIE, viewerFor } from './viewer.ts'

/**
 * Resolving who is signed in, once per request.
 *
 * A guard answers 401/403 from the viewer and throws it away; the handler behind it
 * asks again. That was two identical joins on every authenticated request (#139),
 * and the property worth pinning is that the second ask does not reach the database
 * — proven by changing the answer underneath it rather than by counting queries,
 * since a count would be asserting against the driver rather than the behaviour.
 */

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

    // Changed underneath. A second query would see no account and answer undefined,
    // so an unchanged answer is only possible if there was no second query.
    await deps.db.delete(accountRole).where(eq(accountRole.account_id, ada.id))
    await deps.db.delete(account).where(eq(account.id, ada.id))

    expect(await viewerFor(ada, deps)).toEqual(first)
    expect(first?.roles).toEqual(['member'])
  })

  it('asks again for a different request, so the cache is per request and not per token', async () => {
    // The passing sibling. Without it the test above is also satisfied by a cache
    // keyed on the cookie, which would serve one member's viewer to the next
    // request carrying the same token — including after their roles changed.
    const deps = build()
    const ada = await givenAccount(deps)
    await viewerFor(ada, deps)

    await deps.db.delete(accountRole).where(eq(accountRole.account_id, ada.id))

    const later = await viewerFor({ headers: { ...ada.headers } }, deps)

    expect(later?.roles).toEqual([])
  })

  it('remembers that nobody is signed in, rather than asking again', async () => {
    // A miss and a cached `undefined` are told apart with `has`. On `get` alone the
    // cached `undefined` is falsy and falls through, so a request whose token is
    // *valid but stale* — signature good, account gone — pays for that join on every
    // ask, and the guard plus its handler is two of them.
    //
    // Proven by putting the account back between the two asks: the answer must not
    // change, because nothing asked.
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
