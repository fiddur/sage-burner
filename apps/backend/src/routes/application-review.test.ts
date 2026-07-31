import type { FastifyInstance, LightMyRequestResponse } from 'fastify'

import { eq } from 'drizzle-orm'
import { createHash, randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole, application, inviteToken } from '../db/schema.ts'
import { SESSION_COOKIE } from './auth.ts'

const SECRET = 's'.repeat(40)

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
  })
  return app
}

const db = () => {
  const found = handle?.db
  if (found === undefined) throw new Error('build() first')
  return found
}

const givenAdmin = async () => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, password_hash: null, created_at: '2026-07-01T00:00:00Z' })
  await db().insert(accountRole).values({ account_id: id, role: 'admin' })

  const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })
  return { id, cookie: `${SESSION_COOKIE}=${sessions.issue(id)}` }
}

const givenApplication = async (over: { status?: 'pending' | 'approved' | 'rejected' } = {}) => {
  const id = randomUUID()
  await db()
    .insert(application)
    .values({
      id,
      answers: [{ question_id: randomUUID(), label: 'Why?', type: 'text', value: 'because' }],
      status: over.status ?? 'pending',
      applicant_name: 'Someone',
      applicant_contact: 'someone@example.org',
      submitted_at: '2026-07-02T00:00:00Z',
      decided_at: over.status === undefined || over.status === 'pending' ? null : '2026-07-03T00:00:00Z',
    })
  return id
}

const decide = (
  server: FastifyInstance,
  cookie: string,
  id: string,
  decision: 'approve' | 'reject',
): Promise<LightMyRequestResponse> =>
  server.inject({
    method: 'POST',
    url: `/api/admin/applications/${encodeURIComponent(id)}/${decision}`,
    headers: { cookie },
  })

const list = (server: FastifyInstance, cookie: string) =>
  server.inject({ method: 'GET', url: '/api/admin/applications', headers: { cookie } })

describe('reviewing applications', () => {
  it('lists them with their answers', async () => {
    const server = await build()
    const { cookie } = await givenAdmin()
    await givenApplication()

    const response = await list(server, cookie)

    expect(response.statusCode).toBe(200)
    expect(response.json().applications).toHaveLength(1)
    expect(response.json().applications[0].answers[0].label).toBe('Why?')
  })

  it('refuses an anonymous caller', async () => {
    const server = await build()

    expect((await server.inject({ method: 'GET', url: '/api/admin/applications' })).statusCode).toBe(401)
  })

  it('approves, stamping the decision and minting an invite', async () => {
    const server = await build()
    const { cookie } = await givenAdmin()
    const id = await givenApplication()

    const response = await decide(server, cookie, id, 'approve')

    expect(response.statusCode).toBe(200)
    expect(response.json().application.status).toBe('approved')
    expect(response.json().application.decided_at).not.toBeNull()
    expect(response.json().invite.token).toBeTruthy()
  })

  it('stores only the digest, never the token', async () => {
    const server = await build()
    const { cookie } = await givenAdmin()
    const id = await givenApplication()

    const { token } = (await decide(server, cookie, id, 'approve')).json().invite
    const [row] = await db().select().from(inviteToken)

    expect(row?.token_hash).toBe(createHash('sha256').update(token).digest('hex'))
    expect(row?.token_hash).not.toBe(token)
  })

  it('mints a different token every time', async () => {
    // The one property that cannot be recovered if it is wrong: a predictable
    // token is an open door, and nothing downstream would notice.
    const server = await build()
    const { cookie } = await givenAdmin()

    const tokens = new Set<string>()
    for (let n = 0; n < 5; n++) {
      const id = await givenApplication()
      tokens.add((await decide(server, cookie, id, 'approve')).json().invite.token)
    }

    expect(tokens.size).toBe(5)
    for (const token of tokens) expect(token.length).toBeGreaterThanOrEqual(32)
  })

  it('does not mint a second invite when approved twice', async () => {
    const server = await build()
    const { cookie } = await givenAdmin()
    const id = await givenApplication()

    const first = await decide(server, cookie, id, 'approve')
    const second = await decide(server, cookie, id, 'approve')

    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(409)
    expect(await db().select().from(inviteToken)).toHaveLength(1)
  })

  it('does not let a rejection overwrite an approval', async () => {
    const server = await build()
    const { cookie } = await givenAdmin()
    const id = await givenApplication()

    await decide(server, cookie, id, 'approve')
    const response = await decide(server, cookie, id, 'reject')

    expect(response.statusCode).toBe(409)
    const [row] = await db().select().from(application).where(eq(application.id, id))
    expect(row?.status).toBe('approved')
  })

  it('rejects, stamping the decision and minting nothing', async () => {
    const server = await build()
    const { cookie } = await givenAdmin()
    const id = await givenApplication()

    const response = await decide(server, cookie, id, 'reject')

    expect(response.statusCode).toBe(200)
    expect(response.json().application.status).toBe('rejected')
    expect(response.json().application.decided_at).not.toBeNull()
    expect(response.json().invite).toBeNull()
    expect(await db().select().from(inviteToken)).toHaveLength(0)
  })

  it('answers 404 for an application that does not exist', async () => {
    const server = await build()
    const { cookie } = await givenAdmin()

    expect((await decide(server, cookie, randomUUID(), 'approve')).statusCode).toBe(404)
  })

  it('records which admin approved it', async () => {
    const server = await build()
    const admin = await givenAdmin()
    const id = await givenApplication()

    await decide(server, admin.cookie, id, 'approve')

    const [row] = await db().select().from(inviteToken)
    expect(row?.created_by).toBe(admin.id)
    expect(row?.application_id).toBe(id)
  })

  it('gives the invite an expiry in the future', async () => {
    const server = await build()
    const { cookie } = await givenAdmin()
    const id = await givenApplication()

    const { expires_at } = (await decide(server, cookie, id, 'approve')).json().invite

    expect(Date.parse(expires_at)).toBeGreaterThan(Date.parse('2026-07-02T00:00:00Z'))
  })
})
