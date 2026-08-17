import type { FastifyInstance, LightMyRequestResponse } from 'fastify'

import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DbHandle } from '../db/index.ts'
import type { Delivery, VapidKeys } from '../push/push.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { SESSION_COOKIE } from '../auth/viewer.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole, formQuestion, pushSubscription } from '../db/schema.ts'

const SECRET = 's'.repeat(40)
const NOW = '2026-08-03T00:00:00.000Z'
const KEYS: VapidKeys = { publicKey: 'pub-key', privateKey: 'priv-key' }

let handle: DbHandle | undefined
let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  handle?.close()
  app = undefined
  handle = undefined
})

const db = () => {
  const found = handle?.db
  if (found === undefined) throw new Error('build() first')
  return found
}

const build = async (deliver: Delivery = () => Promise.resolve('sent')) => {
  handle = createDb({ url: ':memory:' })
  runMigrations(handle)
  app = await createApp({
    db: handle.db,
    config: createConfig({ LOG_LEVEL: 'silent', SESSION_SECRET: SECRET }),
    now: () => new Date(NOW),
    deliver,
    mintKeys: () => KEYS,
  })
  return app
}

const givenAccount = async (roles: ('admin' | 'member')[]) => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, password_hash: null, created_at: NOW })
  for (const role of roles) await db().insert(accountRole).values({ account_id: id, role })

  const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })
  return { id, cookie: `${SESSION_COOKIE}=${sessions.issue(id)}` }
}

const A_SUBSCRIPTION = {
  endpoint: 'https://push.example/browser-one',
  p256dh: 'a-public-key',
  auth: 'a-secret',
}

const subscribe = (
  server: FastifyInstance,
  cookie: string | undefined,
  payload: Record<string, unknown> = A_SUBSCRIPTION,
): Promise<LightMyRequestResponse> =>
  server.inject({
    method: 'POST',
    url: '/api/push/subscriptions',
    headers: cookie === undefined ? {} : { cookie },
    payload,
  })

const unsubscribe = (server: FastifyInstance, cookie: string, payload: Record<string, unknown>) =>
  server.inject({ method: 'DELETE', url: '/api/push/subscriptions', headers: { cookie }, payload })

const key = (server: FastifyInstance, cookie?: string) =>
  server.inject({
    method: 'GET',
    url: '/api/push/key',
    headers: cookie === undefined ? {} : { cookie },
  })

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const apply = async (server: FastifyInstance) => {
  const applicant = await givenAccount([])

  return await server.inject({
    method: 'POST',
    url: '/api/applications',
    headers: { cookie: applicant.cookie },
    payload: {
      applicant_name: 'Fredrik',
      applicant_email: 'fredrik@example.org',
      answers: {},
      asked: [],
    },
  })
}

describe('the VAPID key a browser subscribes with', () => {
  it('is minted the first time an admin asks', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])

    const response = await key(server, admin.cookie)

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ public_key: 'pub-key' })
  })

  it('is offered to anybody signed in, and refused to a stranger', async () => {
    const server = await build()
    const member = await givenAccount(['member'])
    const applicant = await givenAccount([])

    expect((await key(server, member.cookie)).statusCode).toBe(200)
    expect((await key(server, applicant.cookie)).statusCode).toBe(200)
    expect((await key(server)).statusCode).toBe(401)
  })
})

describe('subscribing a browser', () => {
  it('stores it against the account in the session, not one in the body', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])

    expect((await subscribe(server, admin.cookie)).statusCode).toBe(204)

    const rows = await db().select().from(pushSubscription)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.account_id).toBe(admin.id)
    expect(rows[0]?.endpoint).toBe(A_SUBSCRIPTION.endpoint)
  })

  it('refuses an account id in the body rather than honouring it', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])
    const victim = await givenAccount(['admin'])

    const response = await subscribe(server, admin.cookie, {
      ...A_SUBSCRIPTION,
      account_id: victim.id,
    })

    expect(response.statusCode).toBe(400)
    expect(await db().select().from(pushSubscription)).toEqual([])
  })

  it('refuses an endpoint that is not an https URL', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])

    for (const endpoint of ['nope', 'http://10.0.0.5/push', 'ftp://example.org/x']) {
      expect(
        (await subscribe(server, admin.cookie, { ...A_SUBSCRIPTION, endpoint })).statusCode,
        endpoint,
      ).toBe(400)
    }

    expect(await db().select().from(pushSubscription)).toEqual([])
  })

  it('takes a member and an account still waiting on a decision, and nobody signed out', async () => {
    const server = await build()
    const member = await givenAccount(['member'])
    const applicant = await givenAccount([])

    expect((await subscribe(server, member.cookie)).statusCode).toBe(204)
    expect(
      (
        await subscribe(server, applicant.cookie, {
          ...A_SUBSCRIPTION,
          endpoint: 'https://push.example/browser-two',
        })
      ).statusCode,
    ).toBe(204)
    expect((await subscribe(server, undefined)).statusCode).toBe(401)
    expect((await db().select().from(pushSubscription)).map((row) => row.account_id).toSorted()).toEqual(
      [member.id, applicant.id].toSorted(),
    )
  })

  it('unsubscribes by endpoint, and is quiet about one it never had', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])
    await subscribe(server, admin.cookie)

    expect((await unsubscribe(server, admin.cookie, { endpoint: A_SUBSCRIPTION.endpoint })).statusCode).toBe(
      204,
    )
    expect(
      (await unsubscribe(server, admin.cookie, { endpoint: 'https://push.example/never' })).statusCode,
    ).toBe(204)

    expect(await db().select().from(pushSubscription)).toEqual([])
  })
})

describe('an application arriving', () => {
  it('notifies every subscribed admin, saying nothing about who applied', async () => {
    const deliver = vi.fn<Delivery>(() => Promise.resolve('sent'))
    const server = await build(deliver)
    const admin = await givenAccount(['admin'])
    await subscribe(server, admin.cookie)

    expect((await apply(server)).statusCode).toBe(201)

    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(1))
    const payload = deliver.mock.calls[0]?.[1] ?? ''
    expect(payload).toContain('applied to join')
    expect(payload).not.toContain('Fredrik')
    expect(payload).not.toContain('fredrik@example.org')
  })

  it('still answers 201 when the push service is down', async () => {
    const server = await build(() => Promise.reject(new Error('push service unreachable')))
    const admin = await givenAccount(['admin'])
    await subscribe(server, admin.cookie)

    const response = await apply(server)

    expect(response.statusCode).toBe(201)
    expect(response.json().application.applicant_name).toBe('Fredrik')
  })

  it('answers before the notification is delivered, rather than waiting for it', async () => {
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const server = await build(async () => {
      await held
      return 'sent'
    })
    const admin = await givenAccount(['admin'])
    await subscribe(server, admin.cookie)

    expect((await apply(server)).statusCode).toBe(201)

    release()
  })

  it('does not notify when the only admin has not subscribed', async () => {
    const deliver = vi.fn<Delivery>(() => Promise.resolve('sent'))
    const server = await build(deliver)
    await givenAccount(['admin'])

    expect((await apply(server)).statusCode).toBe(201)
    await settle()

    expect(deliver).not.toHaveBeenCalled()
  })

  it('does not notify for an application the form refuses', async () => {
    const deliver = vi.fn<Delivery>(() => Promise.resolve('sent'))
    const server = await build(deliver)
    const admin = await givenAccount(['admin'])
    await subscribe(server, admin.cookie)
    await db()
      .insert(formQuestion)
      .values({ id: randomUUID(), type: 'text', label: 'Why?', required: true, order: 0 })

    expect((await apply(server)).statusCode).toBe(400)
    await settle()

    expect(deliver).not.toHaveBeenCalled()
  })
})
