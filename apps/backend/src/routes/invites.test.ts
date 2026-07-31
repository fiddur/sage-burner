import type { FastifyInstance, LightMyRequestResponse } from 'fastify'

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
const NOW = '2026-07-02T00:00:00.000Z'

let handle: DbHandle | undefined
let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  handle?.close()
  app = undefined
  handle = undefined
})

const build = async (now: () => Date = () => new Date(NOW)) => {
  handle = createDb({ url: ':memory:' })
  runMigrations(handle)
  app = await createApp({
    db: handle.db,
    config: createConfig({ LOG_LEVEL: 'silent', SESSION_SECRET: SECRET }),
    now,
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
    .values({ id, email: `${id}@example.org`, password_hash: null, created_at: NOW })
  await db().insert(accountRole).values({ account_id: id, role: 'admin' })

  const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })
  return { id, cookie: `${SESSION_COOKIE}=${sessions.issue(id)}` }
}

const create = (
  server: FastifyInstance,
  cookie: string,
  payload: Record<string, unknown> = {},
): Promise<LightMyRequestResponse> =>
  server.inject({ method: 'POST', url: '/api/admin/invites', headers: { cookie }, payload })

const list = (server: FastifyInstance, cookie: string) =>
  server.inject({ method: 'GET', url: '/api/admin/invites', headers: { cookie } })

const revoke = (server: FastifyInstance, cookie: string, id: string) =>
  server.inject({
    method: 'DELETE',
    url: `/api/admin/invites/${encodeURIComponent(id)}`,
    headers: { cookie },
  })

describe('direct invites', () => {
  it('mints one for someone who skips the form entirely', async () => {
    const server = await build()
    const { cookie } = await givenAdmin()

    const response = await create(server, cookie)

    expect(response.statusCode).toBe(201)
    expect(response.json().invite.token).toBeTruthy()
    const [row] = await db().select().from(inviteToken)
    expect(row?.application_id).toBeNull()
  })

  it('stores only the digest, as the approval path does', async () => {
    const server = await build()
    const { cookie } = await givenAdmin()

    const { token } = (await create(server, cookie)).json().invite
    const [row] = await db().select().from(inviteToken)

    expect(row?.token_hash).toBe(createHash('sha256').update(token).digest('hex'))
  })

  it('defaults to the same 30 days an approval gives', async () => {
    const server = await build()
    const { cookie } = await givenAdmin()

    expect((await create(server, cookie)).json().invite.expires_at).toBe('2026-08-01T00:00:00.000Z')
  })

  it('takes an expiry when the organiser sets one', async () => {
    const server = await build()
    const { cookie } = await givenAdmin()

    const response = await create(server, cookie, { expires_at: '2026-07-10T00:00:00.000Z' })

    expect(response.json().invite.expires_at).toBe('2026-07-10T00:00:00.000Z')
  })

  it('refuses an expiry in the past, which would mint something already dead', async () => {
    const server = await build()
    const { cookie } = await givenAdmin()

    expect((await create(server, cookie, { expires_at: '2026-07-01T00:00:00.000Z' })).statusCode).toBe(400)
    expect(await db().select().from(inviteToken)).toHaveLength(0)
  })

  it('records which admin minted it', async () => {
    const server = await build()
    const admin = await givenAdmin()

    await create(server, admin.cookie)

    expect((await db().select().from(inviteToken))[0]?.created_by).toBe(admin.id)
  })

  it('refuses an anonymous caller', async () => {
    const server = await build()

    expect((await server.inject({ method: 'POST', url: '/api/admin/invites' })).statusCode).toBe(401)
    expect((await server.inject({ method: 'GET', url: '/api/admin/invites' })).statusCode).toBe(401)
  })
})

describe('listing invites', () => {
  it('never returns the digest, let alone the token', async () => {
    const server = await build()
    const { cookie } = await givenAdmin()
    await create(server, cookie)

    const body = (await list(server, cookie)).body

    expect(body).not.toContain('token_hash')
    expect(JSON.parse(body).invites[0].id).toBeTruthy()
  })

  it('calls a live invite outstanding, a redeemed one used, and a lapsed one expired', async () => {
    const server = await build()
    const { id: adminId, cookie } = await givenAdmin()

    const plant = async (over: { expires_at: string; used_at: string | null }) =>
      db()
        .insert(inviteToken)
        .values({
          id: randomUUID(),
          token_hash: randomUUID(),
          application_id: null,
          created_by: adminId,
          ...over,
        })

    await plant({ expires_at: '2026-08-01T00:00:00.000Z', used_at: null })
    await plant({ expires_at: '2026-08-01T00:00:00.000Z', used_at: '2026-07-01T00:00:00.000Z' })
    await plant({ expires_at: '2026-07-01T00:00:00.000Z', used_at: null })

    const statuses = (await list(server, cookie))
      .json()
      .invites.map((invite: { status: string }) => invite.status)

    expect(statuses.toSorted()).toEqual(['expired', 'outstanding', 'used'])
  })

  it('calls a redeemed invite used even after it lapses', async () => {
    // Spent beats lapsed: "expired" would invite re-issuing a link to someone
    // who is already in.
    const server = await build()
    const { id: adminId, cookie } = await givenAdmin()
    await db().insert(inviteToken).values({
      id: randomUUID(),
      token_hash: randomUUID(),
      application_id: null,
      expires_at: '2026-07-01T00:00:00.000Z',
      used_at: '2026-06-30T00:00:00.000Z',
      created_by: adminId,
    })

    expect((await list(server, cookie)).json().invites[0].status).toBe('used')
  })

  it('names the applicant behind an application invite, so the two kinds are distinguishable', async () => {
    const server = await build()
    const { id: adminId, cookie } = await givenAdmin()
    const applicationId = randomUUID()
    await db().insert(application).values({
      id: applicationId,
      answers: [],
      status: 'approved',
      applicant_name: 'Fredrik',
      applicant_contact: 'fredrik@example.org',
      submitted_at: NOW,
      decided_at: NOW,
    })
    await db().insert(inviteToken).values({
      id: randomUUID(),
      token_hash: randomUUID(),
      application_id: applicationId,
      expires_at: '2026-08-01T00:00:00.000Z',
      used_at: null,
      created_by: adminId,
    })
    await create(server, cookie)

    const invites = (await list(server, cookie)).json().invites
    const named = invites.filter(
      (invite: { applicant_name: string | null }) => invite.applicant_name !== null,
    )

    expect(named).toHaveLength(1)
    expect(named[0].applicant_name).toBe('Fredrik')
  })
})

describe('revoking an invite', () => {
  it('removes an outstanding direct invite', async () => {
    const server = await build()
    const { cookie } = await givenAdmin()
    await create(server, cookie)
    const [row] = await db().select().from(inviteToken)

    const response = await revoke(server, cookie, row?.id ?? '')

    expect(response.statusCode).toBe(204)
    expect(await db().select().from(inviteToken)).toHaveLength(0)
  })

  it('answers 404 for an invite that does not exist', async () => {
    const server = await build()
    const { cookie } = await givenAdmin()

    expect((await revoke(server, cookie, randomUUID())).statusCode).toBe(404)
  })

  it('refuses to revoke a redeemed invite', async () => {
    // The row is what records that this person was let in, and `account`
    // references it — deleting it would rewrite how the group formed.
    const server = await build()
    const { id: adminId, cookie } = await givenAdmin()
    const id = randomUUID()
    await db().insert(inviteToken).values({
      id,
      token_hash: randomUUID(),
      application_id: null,
      expires_at: '2026-08-01T00:00:00.000Z',
      used_at: '2026-07-01T00:00:00.000Z',
      created_by: adminId,
    })

    expect((await revoke(server, cookie, id)).statusCode).toBe(409)
    expect(await db().select().from(inviteToken)).toHaveLength(1)
  })

  it('refuses to revoke an application invite, which would strand the approval', async () => {
    // Approved with no invite cannot be recovered through the API — re-approving
    // matches nothing on `status = 'pending'`. #91 owns the re-issue path.
    const server = await build()
    const { id: adminId, cookie } = await givenAdmin()
    const applicationId = randomUUID()
    await db().insert(application).values({
      id: applicationId,
      answers: [],
      status: 'approved',
      applicant_name: 'Fredrik',
      applicant_contact: 'fredrik@example.org',
      submitted_at: NOW,
      decided_at: NOW,
    })
    const id = randomUUID()
    await db().insert(inviteToken).values({
      id,
      token_hash: randomUUID(),
      application_id: applicationId,
      expires_at: '2026-08-01T00:00:00.000Z',
      used_at: null,
      created_by: adminId,
    })

    expect((await revoke(server, cookie, id)).statusCode).toBe(409)
    expect(await db().select().from(inviteToken)).toHaveLength(1)
  })

  it('refuses an anonymous caller', async () => {
    const server = await build()
    const { cookie } = await givenAdmin()
    await create(server, cookie)
    const [row] = await db().select().from(inviteToken)

    const response = await server.inject({
      method: 'DELETE',
      url: `/api/admin/invites/${row?.id ?? ''}`,
    })

    expect(response.statusCode).toBe(401)
    expect(await db().select().from(inviteToken)).toHaveLength(1)
  })
})
