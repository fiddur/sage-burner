import type { FastifyInstance } from 'fastify'

import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { SESSION_COOKIE } from '../auth/viewer.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountConnection, accountRole } from '../db/schema.ts'

const SECRET = 's'.repeat(40)
const NOW = '2026-07-02T00:00:00.000Z'

let handle: DbHandle | undefined
let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  handle?.close()
  app = undefined
  handle = undefined
})

const build = async () => {
  handle = createDb({ url: ':memory:' })
  runMigrations(handle)
  app = await createApp({
    db: handle.db,
    config: createConfig({ LOG_LEVEL: 'silent', SESSION_SECRET: SECRET }),
    now: () => new Date(NOW),
  })
  return app
}

const db = () => {
  const found = handle?.db
  if (found === undefined) throw new Error('build() first')
  return found
}

const givenAccount = async (
  over: { name?: string | null; contact?: string | null; roles?: ('admin' | 'member')[] } = {},
) => {
  const { name = 'Wren Aldertide', contact = 'wren on discord', roles = ['member'] } = over
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, password_hash: null, name, contact, created_at: NOW })
  for (const role of roles) await db().insert(accountRole).values({ account_id: id, role })

  const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })
  return { id, cookie: `${SESSION_COOKIE}=${sessions.issue(id)}` }
}

const givenConnection = async (
  accountId: string,
  kind: 'discord' | 'email' | 'messenger',
  value: string,
  order: number,
) =>
  await db()
    .insert(accountConnection)
    .values({ id: randomUUID(), account_id: accountId, kind, value, label: '', order })

const fetchProfile = (server: FastifyInstance, cookie: string | undefined, accountId: string) =>
  server.inject({
    method: 'GET',
    url: `/api/accounts/${accountId}/profile`,
    headers: cookie === undefined ? {} : { cookie },
  })

describe('somebody, as the rest of the community sees them', () => {
  it('answers the name, the face and how to reach them', async () => {
    const server = await build()
    const wren = await givenAccount()
    const reader = await givenAccount({ name: 'Anna' })
    await givenConnection(wren.id, 'messenger', 'wren', 0)

    const got = await fetchProfile(server, reader.cookie, wren.id)

    expect(got.statusCode).toBe(200)
    expect(got.json().person).toEqual({
      account_id: wren.id,
      name: 'Wren Aldertide',
      avatar: null,
      contact: 'wren on discord',
      connections: [expect.objectContaining({ kind: 'messenger', value: 'wren' })],
    })
  })

  it('keeps the order they chose, which is the answer to the question', async () => {
    const server = await build()
    const wren = await givenAccount()
    const reader = await givenAccount()
    await givenConnection(wren.id, 'email', 'wren@example.org', 0)
    await givenConnection(wren.id, 'discord', 'wren', 1)
    await db()
      .update(accountConnection)
      .set({ order: 2 })
      .where(eq(accountConnection.value, 'wren@example.org'))

    const got = await fetchProfile(server, reader.cookie, wren.id)

    expect(got.json().person.connections.map((row: { kind: string }) => row.kind)).toEqual([
      'discord',
      'email',
    ])
  })

  it('carries nothing else about them, whatever the account row holds', async () => {
    // The projection is written out field by field, which is what keeps a column added to
    // `account` from reaching every member's reading of every other member.
    //
    // `account.email` is the column that matters and this asserts the column: no
    // member-facing read selects it (#159). It is *not* a claim that the address is unseen —
    // every account is seeded with an `email` connection holding the same string, which this
    // page shows on purpose. The two are different things, and the second is a row somebody
    // can delete.
    const server = await build()
    const wren = await givenAccount()
    const reader = await givenAccount()
    await db().update(account).set({ allergies_notes: 'peanuts' }).where(eq(account.id, wren.id))

    const body = await fetchProfile(server, reader.cookie, wren.id)

    expect(Object.keys(body.json().person).toSorted()).toEqual([
      'account_id',
      'avatar',
      'connections',
      'contact',
      'name',
    ])
    // No address at all here, because this account has no `email` connection: the seeding
    // happens on the paths that create an account, and these rows are inserted directly.
    expect(body.payload).not.toContain('@example.org')
    expect(body.payload).not.toContain('peanuts')
  })

  it('has a page for somebody who has filled in nothing', async () => {
    // Half the community will have touched none of this, and a dangling link is worse than
    // a thin page.
    const server = await build()
    const nobody = await givenAccount({ name: null, contact: null })
    const reader = await givenAccount()

    const got = await fetchProfile(server, reader.cookie, nobody.id)

    expect(got.statusCode).toBe(200)
    expect(got.json().person).toMatchObject({ name: null, contact: null, connections: [] })
  })

  it('has one for an organiser who is not coming', async () => {
    // `admin` and `member` are independent, and somebody organising without attending is
    // often the person most in need of reaching.
    const server = await build()
    const organiser = await givenAccount({ roles: ['admin'] })
    const reader = await givenAccount()

    expect((await fetchProfile(server, reader.cookie, organiser.id)).statusCode).toBe(200)
  })

  it('is nobody’s to read who is not approved', async () => {
    const server = await build()
    const wren = await givenAccount()
    const stranger = await givenAccount({ roles: [] })

    expect((await fetchProfile(server, stranger.cookie, wren.id)).statusCode).toBe(403)
    expect((await fetchProfile(server, undefined, wren.id)).statusCode).toBe(401)
  })

  it('answers 404 for an account that is not there', async () => {
    const server = await build()
    const reader = await givenAccount()

    expect((await fetchProfile(server, reader.cookie, randomUUID())).statusCode).toBe(404)
  })

  it('is not cached, since it is somebody’s record', async () => {
    const server = await build()
    const wren = await givenAccount()
    const reader = await givenAccount()

    expect((await fetchProfile(server, reader.cookie, wren.id)).headers['cache-control']).toBe('no-store')
  })
})
