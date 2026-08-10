import type { Thread } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { MAX_POST } from '@sage-burner/shared'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { SESSION_COOKIE } from '../auth/viewer.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole, attendance, event, post } from '../db/schema.ts'

const SECRET = 'p'.repeat(40)
const NOW = '2026-07-02T00:00:00.000Z'
const BURN = 'e0000000-0000-4000-8000-000000000001'
const OVER = 'e0000000-0000-4000-8000-000000000002'

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

const givenAccount = async (name: string, roles: ('admin' | 'member')[] = ['member']) => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, name, password_hash: null, created_at: NOW })
  for (const role of roles) await db().insert(accountRole).values({ account_id: id, role })

  const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })
  return { id, name, cookie: `${SESSION_COOKIE}=${sessions.issue(id)}` }
}

const givenBurn = async (
  id = BURN,
  { start_date = '2026-08-01', end_date = '2026-08-03', slug = 'summer' } = {},
) => {
  await db()
    .insert(event)
    .values({ id, name: 'Summer burn', slug, start_date, end_date, member_cap: 20, created_at: NOW })
}

const givenComing = async (accountId: string, eventId = BURN) => {
  await db()
    .insert(attendance)
    .values({ id: randomUUID(), event_id: eventId, account_id: accountId, joined_at: NOW })
}

const announce = (
  server: FastifyInstance,
  cookie: string,
  payload: Record<string, unknown>,
  eventId = BURN,
) =>
  server.inject({
    method: 'POST',
    url: `/api/events/${eventId}/posts`,
    headers: { cookie },
    payload,
  })

const reword = (server: FastifyInstance, cookie: string, id: string, payload: Record<string, unknown>) =>
  server.inject({ method: 'PATCH', url: `/api/posts/${id}`, headers: { cookie }, payload })

const withdraw = (server: FastifyInstance, cookie: string, id: string) =>
  server.inject({ method: 'DELETE', url: `/api/posts/${id}`, headers: { cookie } })

const cards = async (server: FastifyInstance, cookie: string): Promise<Thread[]> =>
  (await server.inject({ method: 'GET', url: '/api/feed', headers: { cookie } })).json().threads

const bell = async (server: FastifyInstance, cookie: string): Promise<{ category: string; body: string }[]> =>
  (await server.inject({ method: 'GET', url: '/api/me/notifications', headers: { cookie } })).json()
    .notifications

const setOn = (server: FastifyInstance, cookie: string, on: string[]) =>
  server.inject({
    method: 'PUT',
    url: '/api/me/notification-settings',
    headers: { cookie },
    payload: { on, email: [] },
  })

describe('announcing something', () => {
  it('is any approved member’s, and comes back as a card', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)

    const made = await announce(server, ada.cookie, {
      title: 'The planning call is Sunday',
      body: 'Bring a **thing**.',
    })

    expect(made.statusCode).toBe(201)
    const [card] = await cards(server, ada.cookie)
    expect(card?.title).toBe('The planning call is Sunday')
    expect(card?.body).toBe('Bring a **thing**.')
    expect(card?.entries.map((entry) => [entry.kind, entry.author?.name])).toEqual([['posted', 'Ada']])
  })

  it('writes no line beside the card, since one announcement is one thing', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)

    await announce(server, ada.cookie, { title: 'The planning call is Sunday', body: '' })

    const feed = await server.inject({ method: 'GET', url: '/api/feed', headers: { cookie: ada.cookie } })
    expect(feed.json().activity).toEqual([])
  })

  it('links nowhere, because the card is the announcement', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)

    await announce(server, ada.cookie, { title: 'The planning call is Sunday', body: '' })

    expect((await cards(server, ada.cookie))[0]?.link).toBeNull()
  })

  it('tells the burn, and never the author', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    await givenComing(ada.id)
    await givenComing(bea.id)
    await setOn(server, bea.cookie, ['post_written'])
    // Switched on for the author too, or "never the author" would pass on the default being off.
    await setOn(server, ada.cookie, ['post_written'])

    await announce(server, ada.cookie, { title: 'The planning call is Sunday', body: '' })

    expect((await bell(server, bea.cookie)).map((one) => one.body)).toEqual([
      'Ada announced: The planning call is Sunday',
    ])
    expect(await bell(server, ada.cookie)).toEqual([])
  })

  it('is refused for a burn that has already ended', async () => {
    const server = await build()
    await givenBurn(OVER, { start_date: '2026-05-01', end_date: '2026-05-03', slug: 'spring' })
    const ada = await givenAccount('Ada')
    await givenComing(ada.id, OVER)

    expect((await announce(server, ada.cookie, { title: 'Too late', body: '' }, OVER)).statusCode).toBe(404)
  })

  it('wants a title, and bounds the body', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')

    expect((await announce(server, ada.cookie, { title: '   ', body: '' })).statusCode).toBe(400)
    expect(
      (await announce(server, ada.cookie, { title: 'Fine', body: 'a'.repeat(MAX_POST + 1) })).statusCode,
    ).toBe(400)
    expect(
      (await announce(server, ada.cookie, { title: 'Fine', body: 'a'.repeat(MAX_POST) })).statusCode,
    ).toBe(201)
  })

  it('is nobody’s without a session', async () => {
    const server = await build()
    await givenBurn()

    expect((await announce(server, '', { title: 'Hello', body: '' })).statusCode).toBe(401)
  })
})

describe('who the card says may change it', () => {
  it('is the author, an admin, and nobody else', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    const boss = await givenAccount('Cai', ['admin'])
    await givenComing(ada.id)
    await givenComing(bea.id)
    await givenComing(boss.id)

    await announce(server, ada.cookie, { title: 'The planning call is Sunday', body: '' })

    expect((await cards(server, ada.cookie))[0]?.own).toBe(true)
    expect((await cards(server, bea.cookie))[0]?.own).toBe(false)
    expect((await cards(server, boss.cookie))[0]?.own).toBe(true)
  })

  it('is nobody, for a card that is not an announcement', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    await server.inject({
      method: 'POST',
      url: `/api/events/${BURN}/sessions`,
      headers: { cookie: ada.cookie },
      payload: { title: 'Sauna at dawn' },
    })

    expect((await cards(server, ada.cookie))[0]?.own).toBe(false)
  })
})

describe('rewording an announcement', () => {
  const given = async (server: FastifyInstance, cookie: string) => {
    const made = await announce(server, cookie, { title: 'The planning call is Sunday', body: 'Come.' })
    return made.json().post.id as string
  }

  it('is the author’s alone', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    await givenComing(ada.id)
    const id = await given(server, ada.cookie)

    expect((await reword(server, bea.cookie, id, { title: 'Mine now' })).statusCode).toBe(403)
    expect((await reword(server, ada.cookie, id, { title: 'Monday, not Sunday' })).statusCode).toBe(200)
  })

  it('is what the card says afterwards', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const id = await given(server, ada.cookie)

    await reword(server, ada.cookie, id, { title: 'Monday, not Sunday', body: 'Come anyway.' })

    const [card] = await cards(server, ada.cookie)
    expect(card?.title).toBe('Monday, not Sunday')
    expect(card?.body).toBe('Come anyway.')
  })

  it('bumps the card once however many times it is reworded', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const id = await given(server, ada.cookie)

    await reword(server, ada.cookie, id, { body: 'One.' })
    await reword(server, ada.cookie, id, { body: 'Two.' })
    await reword(server, ada.cookie, id, { body: 'Three.' })

    const [card] = await cards(server, ada.cookie)
    expect(card?.entries.map((entry) => entry.kind)).toEqual(['posted', 'edited'])
  })
})

describe('taking an announcement back', () => {
  const given = async (server: FastifyInstance, cookie: string) => {
    const made = await announce(server, cookie, { title: 'The planning call is Sunday', body: 'Come.' })
    return made.json().post.id as string
  }

  it('keeps the conversation and the title, and drops the body', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    await givenComing(ada.id)
    await givenComing(bea.id)
    const id = await given(server, ada.cookie)
    const [before] = await cards(server, ada.cookie)
    await server.inject({
      method: 'POST',
      url: `/api/threads/${before?.id ?? ''}/comments`,
      headers: { cookie: bea.cookie },
      payload: { body: 'see you there' },
    })

    expect((await withdraw(server, ada.cookie, id)).statusCode).toBe(204)

    const [card] = await cards(server, ada.cookie)
    expect(card?.gone).toBe(true)
    expect(card?.title).toBe('The planning call is Sunday')
    expect(card?.body).toBeNull()
    expect(card?.entries.map((entry) => entry.kind)).toEqual(['posted', 'comment', 'withdrawn'])
  })

  it('is the author’s, or an admin’s, and nobody else’s', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    const boss = await givenAccount('Cai', ['admin'])
    await givenComing(ada.id)
    const mine = await given(server, ada.cookie)
    const other = await given(server, ada.cookie)

    expect((await withdraw(server, bea.cookie, mine)).statusCode).toBe(403)
    expect((await withdraw(server, ada.cookie, mine)).statusCode).toBe(204)
    expect((await withdraw(server, boss.cookie, other)).statusCode).toBe(204)
  })

  it('cannot be reworded afterwards', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const id = await given(server, ada.cookie)
    await withdraw(server, ada.cookie, id)

    expect((await reword(server, ada.cookie, id, { title: 'Back on' })).statusCode).toBe(404)
  })

  it('says so once, however many times it is asked', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const id = await given(server, ada.cookie)

    await withdraw(server, ada.cookie, id)
    await withdraw(server, ada.cookie, id)

    const [card] = await cards(server, ada.cookie)
    expect(card?.entries.filter((entry) => entry.kind === 'withdrawn')).toHaveLength(1)
  })

  it('goes with the burn, thread and all', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    await given(server, ada.cookie)

    await db().delete(event).where(eq(event.id, BURN))

    expect(await db().select().from(post)).toEqual([])
  })
})

describe('a conversation under an announcement', () => {
  it('tells whoever announced it, and only asks the rest of the burn', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    const dag = await givenAccount('Dag')
    await givenComing(ada.id)
    await givenComing(bea.id)
    await givenComing(dag.id)
    await announce(server, ada.cookie, { title: 'The planning call is Sunday', body: '' })
    const [card] = await cards(server, ada.cookie)

    await server.inject({
      method: 'POST',
      url: `/api/threads/${card?.id ?? ''}/comments`,
      headers: { cookie: bea.cookie },
      payload: { body: 'see you there' },
    })

    expect((await bell(server, ada.cookie)).map((one) => one.category)).toEqual(['post_comment'])
    expect(await bell(server, bea.cookie)).toEqual([])
    expect(await bell(server, dag.cookie)).toEqual([])
  })

  it('reaches whoever asked about any announcement, on its own switch', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    const dag = await givenAccount('Dag')
    await givenComing(ada.id)
    await givenComing(bea.id)
    await givenComing(dag.id)
    await announce(server, ada.cookie, { title: 'The planning call is Sunday', body: '' })
    const [card] = await cards(server, ada.cookie)
    await setOn(server, dag.cookie, ['post_comment_any'])

    await server.inject({
      method: 'POST',
      url: `/api/threads/${card?.id ?? ''}/comments`,
      headers: { cookie: bea.cookie },
      payload: { body: 'see you there' },
    })

    expect((await bell(server, dag.cookie)).map((one) => one.category)).toEqual(['post_comment_any'])
  })

  it('names the announcement as it is titled now', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    await givenComing(ada.id)
    await givenComing(bea.id)
    const made = await announce(server, ada.cookie, { title: 'Sunday', body: '' })
    await reword(server, ada.cookie, made.json().post.id, { title: 'Monday' })
    const [card] = await cards(server, ada.cookie)

    await server.inject({
      method: 'POST',
      url: `/api/threads/${card?.id ?? ''}/comments`,
      headers: { cookie: bea.cookie },
      payload: { body: 'noted' },
    })

    expect((await bell(server, ada.cookie))[0]?.body).toBe('Bea said something about Monday')
  })
})
