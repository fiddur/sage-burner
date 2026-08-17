import type { BringEntry, Thread } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { everybodyToken, MAX_NOTES, mentionToken } from '@sage-burner/shared'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { SESSION_COOKIE } from '../auth/viewer.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole, attendance, event, notificationBatch } from '../db/schema.ts'
import { bell, cardOf, setOn } from './thread-testing.ts'

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

const add = (server: FastifyInstance, cookie: string, payload: Record<string, unknown>, eventId = BURN) =>
  server.inject({ method: 'POST', url: `/api/events/${eventId}/bring`, headers: { cookie }, payload })

const list = async (server: FastifyInstance, cookie: string, eventId = BURN): Promise<BringEntry[]> =>
  (await server.inject({ method: 'GET', url: `/api/events/${eventId}/bring`, headers: { cookie } })).json()
    .items

const reword = (server: FastifyInstance, cookie: string, id: string, payload: Record<string, unknown>) =>
  server.inject({ method: 'PATCH', url: `/api/bring/${id}`, headers: { cookie }, payload })

const takeOff = (server: FastifyInstance, cookie: string, id: string) =>
  server.inject({ method: 'DELETE', url: `/api/bring/${id}`, headers: { cookie } })

const handUp = (server: FastifyInstance, cookie: string, id: string, accountId: string) =>
  server.inject({
    method: 'POST',
    url: `/api/bring/${id}/hands`,
    headers: { cookie },
    payload: { account_id: accountId },
  })

const handDown = (server: FastifyInstance, cookie: string, id: string, accountId: string) =>
  server.inject({ method: 'DELETE', url: `/api/bring/${id}/hands/${accountId}`, headers: { cookie } })

const cards = async (server: FastifyInstance, cookie: string): Promise<Thread[]> =>
  (await server.inject({ method: 'GET', url: '/api/feed', headers: { cookie } })).json().threads

const say = (server: FastifyInstance, cookie: string, threadId: string, body: string) =>
  server.inject({
    method: 'POST',
    url: `/api/threads/${threadId}/comments`,
    headers: { cookie },
    payload: { body },
  })

describe('asking for something and offering it', () => {
  it('is any approved member’s, and starts with no hands up', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')

    const made = await add(server, ada.cookie, { title: 'Drums to use around the fire' })

    expect(made.statusCode).toBe(201)
    expect(made.json().item).toMatchObject({ author_account_id: ada.id, author_name: 'Ada', hands: [] })
    expect((await list(server, ada.cookie)).map((one) => one.title)).toEqual(['Drums to use around the fire'])
  })

  it('is an offer when whoever adds it says they are bringing it', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)

    const made = await add(server, ada.cookie, { title: 'Huge speakers', bringing: true })

    expect(made.statusCode).toBe(201)
    expect(made.json().item.hands).toEqual([{ account_id: ada.id, name: 'Ada' }])
  })

  it('refuses to record a pledge from somebody not coming, so the page can nudge them to join', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')

    const made = await add(server, ada.cookie, { title: 'Huge speakers', bringing: true })

    expect(made.statusCode).toBe(400)
    expect(made.json().error).toBe('not_attending')
    expect(await list(server, ada.cookie)).toEqual([])
  })

  it('still takes an ask from somebody not coming, which is the shared furniture rule', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')

    expect((await add(server, ada.cookie, { title: 'Drums' })).statusCode).toBe(201)
  })

  it('opens a card on the feed, with a line saying which of the two it was', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)

    await add(server, ada.cookie, { title: 'Drums', comment: 'Anything with a skin.' })

    const [card] = await cards(server, ada.cookie)
    expect(card?.title).toBe('Drums')
    expect(card?.body).toBe('Anything with a skin.')
    expect(card?.entries.map((entry) => [entry.kind, entry.author?.name, entry.body])).toEqual([
      ['added', 'Ada', 'asked for this'],
    ])
  })

  it('is one thing on the feed rather than two, since one item is one thing', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)

    await add(server, ada.cookie, { title: 'Drums' })

    const feed = await server.inject({ method: 'GET', url: '/api/feed', headers: { cookie: ada.cookie } })
    expect(feed.json().threads).toHaveLength(1)
  })

  it('links to the item on the bring list', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)

    const made = await add(server, ada.cookie, { title: 'Drums' })

    expect((await cards(server, ada.cookie))[0]?.link).toBe(`/bring?burn=${BURN}&item=${made.json().item.id}`)
  })

  it('tells the burn, and never whoever added it', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    await givenComing(ada.id)
    await givenComing(bea.id)
    await setOn(server, bea.cookie, ['bring_added'])
    await setOn(server, ada.cookie, ['bring_added'])

    await add(server, ada.cookie, { title: 'Drums' })

    expect((await bell(server, bea.cookie)).map((one) => one.body)).toEqual(['Ada asked for: Drums'])
    expect(await bell(server, ada.cookie)).toEqual([])
  })

  it('says which of the two it was in what the burn is told', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    await givenComing(ada.id)
    await givenComing(bea.id)
    await setOn(server, bea.cookie, ['bring_added'])

    await add(server, ada.cookie, { title: 'Huge speakers', bringing: true })

    expect((await bell(server, bea.cookie)).map((one) => one.body)).toEqual([
      'Ada is bringing: Huge speakers',
    ])
  })

  it('tells whoever the comment names, rather than telling them about the item', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    await givenComing(ada.id)
    await givenComing(bea.id)
    await setOn(server, bea.cookie, ['bring_added', 'mentioned'])

    await add(server, ada.cookie, {
      title: 'Drums',
      comment: `you had one, ${mentionToken('Bea', bea.id)}?`,
    })

    expect((await bell(server, bea.cookie)).map((one) => one.category)).toEqual(['mentioned'])
  })

  it('writes one line in the log for the naming, however many it names', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    for (const name of ['Bea', 'Cai', 'Dee']) await givenComing((await givenAccount(name)).id)
    await givenComing(ada.id)

    await add(server, ada.cookie, { title: 'Drums', comment: `${everybodyToken()} anyone?` })

    const log = await db().select().from(notificationBatch)
    expect(log.filter((row) => row.category === 'mentioned')).toMatchObject([{ told: 3 }])
  })

  it('is refused for a burn that has already ended', async () => {
    const server = await build()
    await givenBurn(OVER, { start_date: '2026-05-01', end_date: '2026-05-03', slug: 'spring' })
    const ada = await givenAccount('Ada')
    await givenComing(ada.id, OVER)

    expect((await add(server, ada.cookie, { title: 'Too late' }, OVER)).statusCode).toBe(404)
  })

  it('wants a name, and bounds the comment', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')

    expect((await add(server, ada.cookie, { title: '   ' })).statusCode).toBe(400)
    expect(
      (await add(server, ada.cookie, { title: 'Fine', comment: 'a'.repeat(MAX_NOTES + 1) })).statusCode,
    ).toBe(400)
    expect(
      (await add(server, ada.cookie, { title: 'Fine', comment: 'a'.repeat(MAX_NOTES) })).statusCode,
    ).toBe(201)
  })

  it('is refused to a signed-in account with no role at all', async () => {
    const server = await build()
    await givenBurn()
    const applicant = await givenAccount('Dag', [])

    expect((await add(server, applicant.cookie, { title: 'Drums' })).statusCode).toBe(403)
    expect(
      (
        await server.inject({
          method: 'GET',
          url: `/api/events/${BURN}/bring`,
          headers: { cookie: applicant.cookie },
        })
      ).statusCode,
    ).toBe(403)
  })

  it('is nobody’s without a session', async () => {
    const server = await build()
    await givenBurn()

    expect((await add(server, '', { title: 'Drums' })).statusCode).toBe(401)
    expect((await server.inject({ method: 'GET', url: `/api/events/${BURN}/bring` })).statusCode).toBe(401)
  })
})

describe('putting a hand up', () => {
  const givenAsk = async (server: FastifyInstance, cookie: string, title = 'Drums') =>
    (await add(server, cookie, { title })).json().item.id as string

  it('records who is bringing it, several people at once', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    await givenComing(ada.id)
    await givenComing(bea.id)
    const item = await givenAsk(server, ada.cookie)

    await handUp(server, bea.cookie, item, bea.id)
    const answered = await handUp(server, ada.cookie, item, ada.id)

    expect(answered.statusCode).toBe(200)
    expect(answered.json().item.hands.map((hand: { name: string }) => hand.name)).toEqual(['Ada', 'Bea'])
  })

  it('rings the asker’s bell, which is the moment the ask paid off', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    await givenComing(ada.id)
    await givenComing(bea.id)
    const item = await givenAsk(server, ada.cookie)

    await handUp(server, bea.cookie, item, bea.id)

    expect((await bell(server, ada.cookie)).map((one) => [one.category, one.body])).toEqual([
      ['bring_answered', 'Bea is bringing Drums'],
    ])
  })

  it('does not ring it for the second hand, the item no longer being an ask', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    const cai = await givenAccount('Cai')
    await givenComing(ada.id)
    await givenComing(bea.id)
    await givenComing(cai.id)
    const item = await givenAsk(server, ada.cookie)

    await handUp(server, bea.cookie, item, bea.id)
    await handUp(server, cai.cookie, item, cai.id)

    expect(await bell(server, ada.cookie)).toHaveLength(1)
  })

  it('never rings it for the asker’s own hand', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const item = await givenAsk(server, ada.cookie)

    await handUp(server, ada.cookie, item, ada.id)

    expect(await bell(server, ada.cookie)).toEqual([])
  })

  it('tells whoever was put on it by somebody else, and never their own click', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    await givenComing(ada.id)
    await givenComing(bea.id)
    const item = await givenAsk(server, ada.cookie)

    await handUp(server, ada.cookie, item, bea.id)

    expect((await bell(server, bea.cookie)).map((one) => [one.category, one.body])).toEqual([
      ['bring_role', 'You are bringing Drums'],
    ])
  })

  it('tells somebody put on their own ask once, as being put on it', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    await givenComing(ada.id)
    await givenComing(bea.id)
    const item = await givenAsk(server, ada.cookie)

    await handUp(server, bea.cookie, item, ada.id)

    expect((await bell(server, ada.cookie)).map((one) => one.category)).toEqual(['bring_role'])
  })

  it('tells whoever is taken off, and says so on the card', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    await givenComing(ada.id)
    await givenComing(bea.id)
    const item = await givenAsk(server, ada.cookie)
    await handUp(server, bea.cookie, item, bea.id)

    const answered = await handDown(server, ada.cookie, item, bea.id)

    expect(answered.json().item.hands).toEqual([])
    expect((await bell(server, bea.cookie)).map((one) => one.body)).toContain(
      'You are no longer bringing Drums',
    )
    expect((await cards(server, ada.cookie))[0]?.entries.map((entry) => entry.body)).toEqual([
      'asked for this',
      'is bringing this',
      'took Bea off bringing it',
    ])
  })

  it('says nothing at all when the hand was already up, or already down', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    await givenComing(ada.id)
    await givenComing(bea.id)
    const item = await givenAsk(server, ada.cookie)

    await handUp(server, ada.cookie, item, bea.id)
    await handUp(server, ada.cookie, item, bea.id)
    await handDown(server, ada.cookie, item, bea.id)
    await handDown(server, ada.cookie, item, bea.id)

    expect(await bell(server, bea.cookie)).toHaveLength(2)
  })

  it('refuses a hand from somebody not coming, so the page can nudge them to join', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    await givenComing(ada.id)
    const item = await givenAsk(server, ada.cookie)

    const refused = await handUp(server, bea.cookie, item, bea.id)

    expect(refused.statusCode).toBe(400)
    expect(refused.json().error).toBe('not_attending')
  })

  it('is refused on an item nobody wants any more', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const item = await givenAsk(server, ada.cookie)
    await takeOff(server, ada.cookie, item)

    expect((await handUp(server, ada.cookie, item, ada.id)).statusCode).toBe(404)
  })

  it('withdraws the pledge when the person leaves the burn', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    await givenComing(ada.id)
    await givenComing(bea.id)
    const item = await givenAsk(server, ada.cookie)
    await handUp(server, bea.cookie, item, bea.id)

    const left = await server.inject({
      method: 'DELETE',
      url: `/api/events/${BURN}/attendance/me`,
      headers: { cookie: bea.cookie },
    })

    expect(left.statusCode).toBe(204)
    expect((await list(server, ada.cookie))[0]?.hands).toEqual([])
  })
})

describe('changing an item', () => {
  it('is whoever added it, and nobody else — not even an admin', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const boss = await givenAccount('Cai', ['admin'])
    await givenComing(ada.id)
    const item = (await add(server, ada.cookie, { title: 'Drums' })).json().item.id

    expect((await reword(server, ada.cookie, item, { title: 'Hand drums' })).statusCode).toBe(200)
    expect((await reword(server, boss.cookie, item, { title: 'Anything' })).statusCode).toBe(403)
    expect((await list(server, ada.cookie))[0]?.title).toBe('Hand drums')
  })

  it('takes it off the list for the author or an admin, and keeps the conversation', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    const boss = await givenAccount('Cai', ['admin'])
    await givenComing(ada.id)
    const first = (await add(server, ada.cookie, { title: 'Drums' })).json().item.id
    const second = (await add(server, ada.cookie, { title: 'Speakers' })).json().item.id
    const before = await cards(server, ada.cookie)

    expect((await takeOff(server, bea.cookie, first)).statusCode).toBe(403)
    expect((await takeOff(server, boss.cookie, first)).statusCode).toBe(204)
    expect((await takeOff(server, ada.cookie, second)).statusCode).toBe(204)

    expect(await list(server, ada.cookie)).toEqual([])
    expect(await cards(server, ada.cookie)).toEqual([])
    const kept = await Promise.all(before.map(async (one) => await cardOf(server, ada.cookie, one.id)))
    expect(kept.map((card) => `${card.title}${card.gone ? ' gone' : ''}`).toSorted()).toEqual([
      'Drums gone',
      'Speakers gone',
    ])
  })

  it('adds one line for a rewording and none for a save that changed nothing', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const item = (await add(server, ada.cookie, { title: 'Drums' })).json().item.id

    await reword(server, ada.cookie, item, { title: 'Drums' })
    await reword(server, ada.cookie, item, {})
    await reword(server, ada.cookie, item, { comment: 'Anything with a skin.' })

    expect((await cards(server, ada.cookie))[0]?.entries.map((entry) => entry.kind)).toEqual([
      'added',
      'edited',
    ])
  })

  it('is refused once the burn has ended', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const item = (await add(server, ada.cookie, { title: 'Drums' })).json().item.id
    await db().update(event).set({ start_date: '2026-05-01', end_date: '2026-05-03' })

    expect((await reword(server, ada.cookie, item, { title: 'Hand drums' })).statusCode).toBe(404)
    expect((await takeOff(server, ada.cookie, item)).statusCode).toBe(404)
  })
})

describe('talking about an item', () => {
  it('tells whoever asked for it and whoever is bringing it, and the rest only if they asked', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    const cai = await givenAccount('Cai')
    const dag = await givenAccount('Dag')
    for (const who of [ada, bea, cai, dag]) await givenComing(who.id)
    await setOn(server, dag.cookie, ['bring_comment_any'])

    const item = (await add(server, ada.cookie, { title: 'Drums' })).json().item
    await handUp(server, bea.cookie, item.id, bea.id)
    const threadId: string = (await list(server, ada.cookie))[0]?.thread_id ?? ''

    await say(server, cai.cookie, threadId, 'Mine is just a small bowl drum')

    expect((await bell(server, ada.cookie)).map((one) => one.category)).toContain('bring_comment')
    expect((await bell(server, bea.cookie)).map((one) => one.category)).toContain('bring_comment')
    expect((await bell(server, dag.cookie)).map((one) => one.category)).toEqual(['bring_comment_any'])
    expect(await bell(server, cai.cookie)).toEqual([])
  })

  it('links what it says back to the item', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    await givenComing(ada.id)
    await givenComing(bea.id)
    const item = (await add(server, ada.cookie, { title: 'Drums' })).json().item.id
    const threadId: string = (await list(server, ada.cookie))[0]?.thread_id ?? ''

    await say(server, bea.cookie, threadId, 'I have two')

    expect((await bell(server, ada.cookie))[0]).toMatchObject({
      body: 'Bea said something about Drums',
      link: `/bring?burn=${BURN}&item=${item}`,
    })
  })

  it('counts a pledge as being part of it, so the card is followed without saying so', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    await givenComing(ada.id)
    await givenComing(bea.id)
    const item = (await add(server, ada.cookie, { title: 'Drums' })).json().item.id
    await handUp(server, bea.cookie, item, bea.id)

    expect((await cards(server, bea.cookie))[0]?.followed_by_me).toBe(true)
  })

  it('says the item is the author’s to change, and nobody else’s', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    await givenComing(ada.id)
    await givenComing(bea.id)
    await add(server, ada.cookie, { title: 'Drums' })

    expect((await cards(server, ada.cookie))[0]?.own).toBe(true)
    expect((await cards(server, bea.cookie))[0]?.own).toBe(false)
  })
})
