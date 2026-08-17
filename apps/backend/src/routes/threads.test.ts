import type { Thread } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import {
  everybodyToken,
  MAX_COMMENT,
  mentionsIn,
  mentionToken,
  notificationCategories,
} from '@sage-burner/shared'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { SESSION_COOKIE } from '../auth/viewer.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import {
  account,
  accountRole,
  attendance,
  event,
  notificationBatch,
  thread,
  threadEntry,
} from '../db/schema.ts'
import { sendGuarded } from '../if-match.testing.ts'

const SECRET = 't'.repeat(40)
const NOW = '2026-07-02T00:00:00.000Z'
const AFTER_THE_BURN = '2026-09-01T00:00:00.000Z'
const BURN = 'e0000000-0000-4000-8000-000000000001'

let handle: DbHandle | undefined
let app: FastifyInstance | undefined
let stamp = NOW

afterEach(async () => {
  await app?.close()
  handle?.close()
  app = undefined
  handle = undefined
  stamp = NOW
})

const db = () => {
  const found = handle?.db
  if (found === undefined) throw new Error('build() first')
  return found
}

const client = () => {
  const found = handle?.client
  if (found === undefined) throw new Error('build() first')
  return found
}

const build = async () => {
  handle = createDb({ url: ':memory:' })
  runMigrations(handle)
  app = await createApp({
    db: handle.db,
    config: createConfig({ LOG_LEVEL: 'silent', SESSION_SECRET: SECRET }),
    now: () => new Date(stamp),
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

const givenBurn = async () => {
  await db().insert(event).values({
    id: BURN,
    name: 'Summer burn',
    slug: 'summer',
    start_date: '2026-08-01',
    end_date: '2026-08-03',
    member_cap: 20,
    created_at: NOW,
  })
}

const givenComing = async (accountId: string) => {
  await db()
    .insert(attendance)
    .values({ id: randomUUID(), event_id: BURN, account_id: accountId, joined_at: NOW })
}

const offerDream = async (server: FastifyInstance, cookie: string, title: string) => {
  const response = await server.inject({
    method: 'POST',
    url: `/api/events/${BURN}/sessions`,
    headers: { cookie },
    payload: { title },
  })

  const dream = response.json().session.id as string
  const [row] = await db().select({ id: thread.id }).from(thread).where(eq(thread.entity_id, dream)).limit(1)

  if (row === undefined) throw new Error('a dream was offered without a thread')

  return { dream, thread: row.id }
}

const read = (server: FastifyInstance, id: string, cookie?: string) =>
  server.inject({
    method: 'GET',
    url: `/api/threads/${id}`,
    ...(cookie === undefined ? {} : { headers: { cookie } }),
  })

const say = (server: FastifyInstance, cookie: string, id: string, body: string) =>
  server.inject({
    method: 'POST',
    url: `/api/threads/${id}/comments`,
    headers: { cookie },
    payload: { body },
  })

const rewrite = (server: FastifyInstance, cookie: string, id: string, body: string) =>
  server.inject({ method: 'PATCH', url: `/api/comments/${id}`, headers: { cookie }, payload: { body } })

const remove = (server: FastifyInstance, cookie: string, id: string) =>
  server.inject({ method: 'DELETE', url: `/api/comments/${id}`, headers: { cookie } })

const entriesOf = async (server: FastifyInstance, cookie: string, id: string): Promise<Thread['entries']> =>
  (await read(server, id, cookie)).json().thread.entries

const setOn = (server: FastifyInstance, cookie: string, on: string[]) =>
  server.inject({
    method: 'PUT',
    url: '/api/me/notification-settings',
    headers: { cookie },
    payload: { on, email: [], digest: 'daily' },
  })

const bell = async (
  server: FastifyInstance,
  cookie: string,
): Promise<{ category: string; body: string; link: string | null }[]> =>
  (await server.inject({ method: 'GET', url: '/api/me/notifications', headers: { cookie } })).json()
    .notifications

describe('a thread', () => {
  it('reads whole, oldest first', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const { thread: id } = await offerDream(server, ada.cookie, 'Sauna at dawn')

    await say(server, ada.cookie, id, 'bring a towel')

    const answer = (await read(server, id, ada.cookie)).json().thread
    expect(answer.title).toBe('Sauna at dawn')
    expect(answer.entry_count).toBe(2)
    expect(answer.entries.map((entry: { body: string }) => entry.body)).toEqual([
      'offered this dream',
      'bring a towel',
    ])
  })

  it('names whoever wrote each line, from the account rather than the words', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const { thread: id } = await offerDream(server, ada.cookie, 'Sauna at dawn')
    await say(server, ada.cookie, id, 'bring a towel')

    await server.inject({
      method: 'PATCH',
      url: '/api/me/profile',
      headers: { cookie: ada.cookie },
      payload: { name: 'Ada Lovelace' },
    })

    const entries = await entriesOf(server, ada.cookie, id)
    expect(entries.map((entry) => entry.author?.name)).toEqual(['Ada Lovelace', 'Ada Lovelace'])
  })

  it('refuses a reader without a role, and anybody signed out', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const { thread: id } = await offerDream(server, ada.cookie, 'Sauna at dawn')
    const nobody = await givenAccount('Nemo', [])

    expect((await read(server, id)).statusCode).toBe(401)
    expect((await read(server, id, nobody.cookie)).statusCode).toBe(403)
    expect((await say(server, nobody.cookie, id, 'hello')).statusCode).toBe(403)
  })

  it('is a 404 for an id nothing is about', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')

    expect((await read(server, randomUUID(), ada.cookie)).statusCode).toBe(404)
    expect((await say(server, ada.cookie, randomUUID(), 'hello')).statusCode).toBe(404)
  })

  it('refuses a comment that says nothing, and one longer than the limit', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const { thread: id } = await offerDream(server, ada.cookie, 'Sauna at dawn')

    expect((await say(server, ada.cookie, id, '   ')).statusCode).toBe(400)
    expect((await say(server, ada.cookie, id, 'x'.repeat(MAX_COMMENT + 1))).statusCode).toBe(400)
    expect((await say(server, ada.cookie, id, 'x'.repeat(MAX_COMMENT))).statusCode).toBe(200)
  })

  it('takes a comment on a burn that has ended, where every other write is refused', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const { dream, thread: id } = await offerDream(server, ada.cookie, 'Sauna at dawn')

    stamp = AFTER_THE_BURN

    const moved = await sendGuarded((headers) =>
      server.inject({
        method: 'PATCH',
        url: `/api/sessions/${dream}`,
        headers: { cookie: ada.cookie, ...headers },
        payload: { title: 'Sauna at dusk' },
      }),
    )
    expect(moved.statusCode).toBe(404)

    expect((await say(server, ada.cookie, id, 'that was lovely')).statusCode).toBe(200)
  })

  it('lets the author rewrite what they said, and says it was rewritten', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const { thread: id } = await offerDream(server, ada.cookie, 'Sauna at dawn')
    await say(server, ada.cookie, id, 'bring a towl')

    const [comment] = (await entriesOf(server, ada.cookie, id)).filter((entry) => entry.kind === 'comment')
    if (comment === undefined) throw new Error('no comment')
    expect(comment.edited_at).toBeNull()

    expect((await rewrite(server, ada.cookie, comment.id, 'bring a towel')).statusCode).toBe(200)

    const [after] = (await entriesOf(server, ada.cookie, id)).filter((entry) => entry.kind === 'comment')
    expect(after?.body).toBe('bring a towel')
    expect(after?.edited_at).toBe(NOW)
  })

  it('refuses to let anybody rewrite what somebody else said, admin included', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const cai = await givenAccount('Cai', ['admin'])
    const bea = await givenAccount('Bea')
    await givenComing(ada.id)
    const { thread: id } = await offerDream(server, ada.cookie, 'Sauna at dawn')
    await say(server, ada.cookie, id, 'bring a towel')

    const [comment] = (await entriesOf(server, ada.cookie, id)).filter((entry) => entry.kind === 'comment')
    if (comment === undefined) throw new Error('no comment')

    expect((await rewrite(server, bea.cookie, comment.id, 'bring nothing')).statusCode).toBe(404)
    expect((await rewrite(server, cai.cookie, comment.id, 'bring nothing')).statusCode).toBe(404)
  })

  it('refuses to rewrite or remove a line the app wrote', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const cai = await givenAccount('Cai', ['admin'])
    await givenComing(ada.id)
    const { thread: id } = await offerDream(server, ada.cookie, 'Sauna at dawn')

    const [offered] = await entriesOf(server, ada.cookie, id)
    if (offered === undefined) throw new Error('no entry')

    expect((await rewrite(server, ada.cookie, offered.id, 'never happened')).statusCode).toBe(404)
    expect((await remove(server, cai.cookie, offered.id)).statusCode).toBe(404)
  })

  it('lets the author take a comment back, and an admin take anyone down', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    const cai = await givenAccount('Cai', ['admin'])
    await givenComing(ada.id)
    await givenComing(bea.id)
    const { thread: id } = await offerDream(server, ada.cookie, 'Sauna at dawn')
    await say(server, ada.cookie, id, 'mine')
    await say(server, bea.cookie, id, 'theirs')

    const comments = (await entriesOf(server, ada.cookie, id)).filter((entry) => entry.kind === 'comment')
    const [mine, theirs] = comments
    if (mine === undefined || theirs === undefined) throw new Error('no comments')

    expect((await remove(server, bea.cookie, mine.id)).statusCode).toBe(404)
    expect((await remove(server, ada.cookie, mine.id)).statusCode).toBe(200)
    expect((await remove(server, cai.cookie, theirs.id)).statusCode).toBe(200)

    expect((await entriesOf(server, ada.cookie, id)).map((entry) => entry.kind)).toEqual(['offered'])
  })

  it('tells the people in the conversation, and nobody else', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    const dag = await givenAccount('Dag')
    await givenComing(ada.id)
    await givenComing(bea.id)
    await givenComing(dag.id)
    const { thread: id } = await offerDream(server, ada.cookie, 'Sauna at dawn')

    await say(server, bea.cookie, id, 'is one person enough to hold space?')

    expect((await bell(server, ada.cookie)).map((one) => one.category)).toEqual(['dream_comment'])
    expect(await bell(server, bea.cookie)).toEqual([])
    expect(await bell(server, dag.cookie)).toEqual([])
  })

  it('does not enrol whoever moved a dream in the grid', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    const cai = await givenAccount('Cai')
    await givenComing(ada.id)
    await givenComing(bea.id)
    await givenComing(cai.id)
    const { dream, thread: id } = await offerDream(server, ada.cookie, 'Sauna at dawn')

    await sendGuarded((headers) =>
      server.inject({
        method: 'PATCH',
        url: `/api/sessions/${dream}`,
        headers: { cookie: bea.cookie, ...headers },
        payload: {
          time_slot_start: '2026-08-01T09:00:00.000Z',
          time_slot_end: '2026-08-01T10:00:00.000Z',
        },
      }),
    )

    await say(server, cai.cookie, id, 'is one person enough?')

    expect((await bell(server, ada.cookie)).map((one) => one.category)).toEqual(['dream_comment'])
    expect(await bell(server, bea.cookie)).toEqual([])
  })

  it('counts saying something as asking to hear the answer', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    await givenComing(ada.id)
    await givenComing(bea.id)
    const { thread: id } = await offerDream(server, ada.cookie, 'Sauna at dawn')

    await say(server, bea.cookie, id, 'is one person enough?')
    await say(server, ada.cookie, id, 'one is plenty')

    expect((await bell(server, bea.cookie)).map((one) => one.body)).toEqual([
      'Ada said something about Sauna at dawn',
    ])
  })

  it('tells somebody who was handed the dream without ever saying anything', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    await givenComing(ada.id)
    await givenComing(bea.id)
    const { dream, thread: id } = await offerDream(server, ada.cookie, 'Sauna at dawn')

    await sendGuarded((headers) =>
      server.inject({
        method: 'PATCH',
        url: `/api/sessions/${dream}`,
        headers: { cookie: ada.cookie, ...headers },
        payload: { facilitator_account_id: bea.id },
      }),
    )
    await say(server, ada.cookie, id, 'what do you need?')

    expect((await bell(server, bea.cookie)).map((one) => one.category)).toEqual([
      'dream_comment',
      'dream_role',
    ])
  })

  it('writes a line for a hand up, saying whose it was', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    await givenComing(ada.id)
    await givenComing(bea.id)
    const { dream, thread: id } = await offerDream(server, ada.cookie, 'Sauna at dawn')

    await server.inject({
      method: 'POST',
      url: `/api/sessions/${dream}/helpers`,
      headers: { cookie: bea.cookie },
      payload: { account_id: bea.id },
    })
    await server.inject({
      method: 'POST',
      url: `/api/sessions/${dream}/helpers`,
      headers: { cookie: ada.cookie },
      payload: { account_id: ada.id },
    })

    expect(
      (await entriesOf(server, ada.cookie, id)).map((entry) => [entry.author?.name, entry.body]),
    ).toEqual([
      ['Ada', 'offered this dream'],
      ['Bea', 'put a hand up to help'],
      ['Ada', 'put a hand up to help'],
    ])
  })

  it('says who was asked, when somebody is put down by another', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    await givenComing(ada.id)
    await givenComing(bea.id)
    const { dream, thread: id } = await offerDream(server, ada.cookie, 'Sauna at dawn')

    await server.inject({
      method: 'POST',
      url: `/api/sessions/${dream}/helpers`,
      headers: { cookie: ada.cookie },
      payload: { account_id: bea.id },
    })
    await server.inject({
      method: 'DELETE',
      url: `/api/sessions/${dream}/helpers/${bea.id}`,
      headers: { cookie: ada.cookie },
    })

    expect((await entriesOf(server, ada.cookie, id)).map((entry) => entry.body)).toEqual([
      'offered this dream',
      'asked Bea to help',
      'took Bea off helping',
    ])
  })

  it('says which way the facilitating went', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    await givenComing(ada.id)
    await givenComing(bea.id)
    const { dream, thread: id } = await offerDream(server, ada.cookie, 'Sauna at dawn')

    const facilitate = (cookie: string, accountId: string | null) =>
      sendGuarded((headers) =>
        server.inject({
          method: 'PATCH',
          url: `/api/sessions/${dream}`,
          headers: { cookie, ...headers },
          payload: { facilitator_account_id: accountId },
        }),
      )

    await facilitate(ada.cookie, ada.id)
    await facilitate(ada.cookie, bea.id)
    await facilitate(bea.cookie, null)

    expect(
      (await entriesOf(server, ada.cookie, id)).map((entry) => [entry.author?.name, entry.body]),
    ).toEqual([
      ['Ada', 'offered this dream'],
      ['Ada', 'is facilitating it'],
      ['Ada', 'asked Bea to facilitate'],
      ['Bea', 'stepped back from facilitating'],
    ])
  })

  it('refuses a kind the vocabulary has never heard of, and a comment nobody wrote', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const { thread: id } = await offerDream(server, ada.cookie, 'Sauna at dawn')

    const insert = (kind: string, author: string | null) =>
      client()
        .prepare(
          'insert into thread_entry (id, thread_id, kind, seq, author_account_id, body, created_at) values (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(randomUUID(), id, kind, 99, author, 'something', NOW)

    expect(() => insert('gossip', ada.id)).toThrow()
    expect(() => insert('comment', null)).toThrow()
    expect(() => insert('comment', ada.id)).not.toThrow()
  })

  it('keeps one conversation per thing', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const { dream } = await offerDream(server, ada.cookie, 'Sauna at dawn')

    expect(() =>
      client()
        .prepare('insert into thread (id, event_id, entity_type, entity_id, title) values (?, ?, ?, ?, ?)')
        .run(randomUUID(), BURN, 'session', dream, 'Sauna at dawn'),
    ).toThrow()
  })

  it('takes the words of an erased account with it', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    await givenComing(bea.id)
    const { thread: id } = await offerDream(server, ada.cookie, 'Sauna at dawn')
    await say(server, bea.cookie, id, 'bring a towel')

    await db().delete(account).where(eq(account.id, ada.id))

    expect((await entriesOf(server, bea.cookie, id)).map((entry) => entry.body)).toEqual(['bring a towel'])
  })

  it('says nothing has happened yet rather than answering an empty date', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)

    const id = randomUUID()
    client()
      .prepare('insert into thread (id, event_id, entity_type, entity_id, title) values (?, ?, ?, ?, ?)')
      .run(id, BURN, 'session', randomUUID(), 'A dream from before')

    const answer = (await read(server, id, ada.cookie)).json().thread
    expect(answer.last_at).toBeNull()
    expect(answer.entry_count).toBe(0)
    expect(answer.entries).toEqual([])
  })

  it('keeps the conversation when the burn is deleted only until the burn is deleted', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const { thread: id } = await offerDream(server, ada.cookie, 'Sauna at dawn')

    await db().delete(event).where(eq(event.id, BURN))

    expect(await db().select().from(thread)).toEqual([])
    expect(await db().select().from(threadEntry)).toEqual([])
    expect((await read(server, id, ada.cookie)).statusCode).toBe(404)
  })
})

describe('a conversation about a person', () => {
  const joinBurn = (server: FastifyInstance, cookie: string) =>
    server.inject({ method: 'POST', url: `/api/events/${BURN}/attendance/me`, headers: { cookie } })

  const introduce = (server: FastifyInstance, cookie: string, introduction: string) =>
    server.inject({ method: 'PATCH', url: '/api/me/profile', headers: { cookie }, payload: { introduction } })

  const cardOf = async (server: FastifyInstance, cookie: string): Promise<Thread> => {
    const [card] = (await server.inject({ method: 'GET', url: '/api/feed', headers: { cookie } })).json()
      .threads as Thread[]
    if (card === undefined) throw new Error('no card')

    return card
  }

  it('tells the person it is about, and only asks the rest of the burn', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    const dag = await givenAccount('Dag')
    await givenComing(bea.id)
    await givenComing(dag.id)
    await joinBurn(server, ada.cookie)
    const card = await cardOf(server, ada.cookie)

    await say(server, bea.cookie, card.id, 'good to have you')

    expect((await bell(server, ada.cookie)).map((one) => one.category)).toEqual(['introduction_comment'])
    expect(await bell(server, bea.cookie)).toEqual([])
    expect(await bell(server, dag.cookie)).toEqual([])
  })

  it('reaches whoever asked about anybody’s card, on its own switch', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    const dag = await givenAccount('Dag')
    await givenComing(bea.id)
    await givenComing(dag.id)
    await joinBurn(server, ada.cookie)
    const card = await cardOf(server, ada.cookie)
    await setOn(server, dag.cookie, ['introduction_comment_any'])

    await say(server, bea.cookie, card.id, 'good to have you')

    expect((await bell(server, dag.cookie)).map((one) => one.category)).toEqual(['introduction_comment_any'])
  })

  it('tells them and links to their page after they have stopped coming', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    await givenComing(bea.id)
    await joinBurn(server, ada.cookie)
    const card = await cardOf(server, ada.cookie)
    await server.inject({
      method: 'DELETE',
      url: `/api/events/${BURN}/attendance/me`,
      headers: { cookie: ada.cookie },
    })

    await say(server, bea.cookie, card.id, 'sorry you cannot make it')

    const [told] = await bell(server, ada.cookie)
    expect(told?.body).toBe('Bea said something about Ada')
    expect(told?.link).toBe(`/members/${ada.id}`)
  })

  it('names the person rather than the title stored when they joined', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    await givenComing(bea.id)
    await joinBurn(server, ada.cookie)
    const card = await cardOf(server, ada.cookie)
    await db().update(account).set({ name: 'Ada B' }).where(eq(account.id, ada.id))

    await say(server, bea.cookie, card.id, 'good to have you')

    const [told] = await bell(server, ada.cookie)
    expect(told?.body).toBe('Bea said something about Ada B')
  })

  it('says nothing to the burn when an introduction is taken away again', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    await givenComing(bea.id)
    await joinBurn(server, ada.cookie)
    await setOn(server, bea.cookie, ['introduction_written'])
    await introduce(server, ada.cookie, 'I build saunas.')

    await introduce(server, ada.cookie, '')

    expect(await bell(server, bea.cookie)).toHaveLength(1)
  })

  it('tells the burn when somebody says who they are, and never the author', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    await givenComing(bea.id)
    await joinBurn(server, ada.cookie)
    await setOn(server, bea.cookie, ['introduction_written'])

    await server.inject({
      method: 'PATCH',
      url: '/api/me/profile',
      headers: { cookie: ada.cookie },
      payload: { introduction: 'I build saunas.' },
    })

    expect((await bell(server, bea.cookie)).map((one) => one.body)).toEqual(['Ada says who they are.'])
    expect(await bell(server, ada.cookie)).toEqual([])
  })
})

describe('naming somebody in a comment', () => {
  it('tells whoever was named, and tells them that rather than the pile', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    await givenComing(ada.id)
    await givenComing(bea.id)
    const { thread: id } = await offerDream(server, ada.cookie, 'Sauna at dawn')

    await say(server, bea.cookie, id, `what do you think ${mentionToken('Ada', ada.id)}?`)

    expect((await bell(server, ada.cookie)).map((one) => one.category)).toEqual(['mentioned'])
  })

  it('reaches the whole burn for everybody, and never the author', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    const dag = await givenAccount('Dag')
    await givenComing(ada.id)
    await givenComing(bea.id)
    await givenComing(dag.id)
    const { thread: id } = await offerDream(server, ada.cookie, 'Sauna at dawn')

    await say(server, bea.cookie, id, `${everybodyToken()} the call is Sunday`)

    expect((await bell(server, dag.cookie)).map((one) => one.category)).toEqual(['mentioned'])
    expect((await bell(server, ada.cookie)).map((one) => one.category)).toEqual(['mentioned'])
    expect(await bell(server, bea.cookie)).toEqual([])
    const log = await db().select().from(notificationBatch)
    expect(log.filter((row) => row.category === 'mentioned')).toMatchObject([{ told: 2 }])
  })

  it('still says what somebody did ask for when they have turned being named off', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    await givenComing(ada.id)
    await givenComing(bea.id)
    const { thread: id } = await offerDream(server, ada.cookie, 'Sauna at dawn')
    await setOn(server, ada.cookie, ['dream_comment'])

    await say(server, bea.cookie, id, `what do you think ${mentionToken('Ada', ada.id)}?`)

    expect((await bell(server, ada.cookie)).map((one) => one.category)).toEqual(['dream_comment'])
  })

  it('drops a name that is not coming to this burn, whatever the composer allowed', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    const elsewhere = await givenAccount('Eve')
    await givenComing(ada.id)
    await givenComing(bea.id)
    const { thread: id } = await offerDream(server, ada.cookie, 'Sauna at dawn')

    await say(server, bea.cookie, id, `hello ${mentionToken('Eve', elsewhere.id)}`)

    expect(await bell(server, elsewhere.cookie)).toEqual([])
  })

  it('tells only whoever was added when a comment is fixed up', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    const dag = await givenAccount('Dag')
    await givenComing(ada.id)
    await givenComing(bea.id)
    await givenComing(dag.id)
    const { thread: id } = await offerDream(server, ada.cookie, 'Sauna at dawn')
    await say(server, bea.cookie, id, `hello ${mentionToken('Ada', ada.id)}`)
    const [said] = (await entriesOf(server, bea.cookie, id)).filter((entry) => entry.kind === 'comment')

    await rewrite(
      server,
      bea.cookie,
      said?.id ?? '',
      `hello ${mentionToken('Ada', ada.id)} and ${mentionToken('Dag', dag.id)}`,
    )

    expect((await bell(server, dag.cookie)).map((one) => one.category)).toEqual(['mentioned'])
    expect(await bell(server, ada.cookie)).toHaveLength(1)
  })

  it('shows the name whoever is named goes by now, not the one that was typed', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    await givenComing(ada.id)
    await givenComing(bea.id)
    const { thread: id } = await offerDream(server, ada.cookie, 'Sauna at dawn')
    await say(server, bea.cookie, id, `hello ${mentionToken('Ada', ada.id)}`)

    await db().update(account).set({ name: 'Ada B' }).where(eq(account.id, ada.id))

    const [comment] = (await entriesOf(server, bea.cookie, id)).filter((entry) => entry.kind === 'comment')
    expect(mentionsIn(comment?.body ?? '')).toEqual([{ name: 'Ada B', target: ada.id }])
  })

  it('keeps what was typed when the account cannot be looked up any more', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const { thread: id } = await offerDream(server, ada.cookie, 'Sauna at dawn')
    await say(server, ada.cookie, id, `hello ${mentionToken('Nobody', 'a-gone')}`)

    const [comment] = (await entriesOf(server, ada.cookie, id)).filter((entry) => entry.kind === 'comment')
    expect(mentionsIn(comment?.body ?? '')).toEqual([{ name: 'Nobody', target: 'a-gone' }])
  })
})

describe('the heart on a comment', () => {
  const love = (server: FastifyInstance, cookie: string, id: string) =>
    server.inject({ method: 'POST', url: `/api/comments/${id}/support/me`, headers: { cookie } })

  const unlove = (server: FastifyInstance, cookie: string, id: string) =>
    server.inject({ method: 'DELETE', url: `/api/comments/${id}/support/me`, headers: { cookie } })

  const setUp = async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const { thread: id } = await offerDream(server, ada.cookie, 'Sauna at dawn')
    await say(server, ada.cookie, id, 'is one mat enough?')
    const [said] = (await entriesOf(server, ada.cookie, id)).filter((entry) => entry.kind === 'comment')
    if (said === undefined) throw new Error('no comment')

    return { server, ada, card: id, comment: said }
  }

  it('gives one, and says whose it is', async () => {
    const { server, ada, card, comment } = await setUp()

    const given = await love(server, ada.cookie, comment.id)

    expect(given.statusCode).toBe(200)
    const [after] = (await entriesOf(server, ada.cookie, card)).filter((one) => one.kind === 'comment')
    expect(after?.support_count).toBe(1)
    expect(after?.supported_by_me).toBe(true)
    expect(after?.supporters.map((person) => person.name)).toEqual(['Ada'])
  })

  it('takes it back', async () => {
    const { server, ada, card, comment } = await setUp()
    await love(server, ada.cookie, comment.id)

    await unlove(server, ada.cookie, comment.id)

    const [after] = (await entriesOf(server, ada.cookie, card)).filter((one) => one.kind === 'comment')
    expect(after?.support_count).toBe(0)
    expect(after?.supported_by_me).toBe(false)
  })

  it('counts one heart per person however many times it is given', async () => {
    const { server, ada, card, comment } = await setUp()

    await love(server, ada.cookie, comment.id)
    await love(server, ada.cookie, comment.id)

    const [after] = (await entriesOf(server, ada.cookie, card)).filter((one) => one.kind === 'comment')
    expect(after?.support_count).toBe(1)
  })

  it('is somebody else’s to give as well, and each is their own', async () => {
    const { server, ada, card, comment } = await setUp()
    const bea = await givenAccount('Bea')
    await givenComing(bea.id)

    await love(server, bea.cookie, comment.id)

    const [mine] = (await entriesOf(server, ada.cookie, card)).filter((one) => one.kind === 'comment')
    expect(mine?.support_count).toBe(1)
    expect(mine?.supported_by_me).toBe(false)
    const [theirs] = (await entriesOf(server, bea.cookie, card)).filter((one) => one.kind === 'comment')
    expect(theirs?.supported_by_me).toBe(true)
  })

  it('goes with the comment when it is taken back', async () => {
    const { server, ada, comment } = await setUp()
    await love(server, ada.cookie, comment.id)

    await remove(server, ada.cookie, comment.id)

    expect(client().prepare('select count(*) as n from entry_support').get()?.n).toBe(0)
  })

  it('is refused to somebody who is not approved', async () => {
    const { server, comment } = await setUp()
    const nobody = await givenAccount('Nobody', [])

    expect((await love(server, nobody.cookie, comment.id)).statusCode).toBe(403)
  })

  it('answers 404 for a comment nobody has', async () => {
    const { server, ada } = await setUp()

    expect((await love(server, ada.cookie, randomUUID())).statusCode).toBe(404)
  })

  it('tells whoever said it, once, and says who hearted it', async () => {
    const { server, ada, comment } = await setUp()
    const bea = await givenAccount('Bea')
    await givenComing(bea.id)

    await love(server, bea.cookie, comment.id)
    await love(server, bea.cookie, comment.id)

    expect(await bell(server, ada.cookie)).toMatchObject([
      { category: 'hearted', body: 'Bea hearts what you said about Sauna at dawn' },
    ])
  })

  it('says nothing for your own, taking your own heart being nobody’s news', async () => {
    const { server, ada, comment } = await setUp()

    await love(server, ada.cookie, comment.id)

    expect(await bell(server, ada.cookie)).toEqual([])
  })

  it('says nothing when it is taken back', async () => {
    const { server, ada, comment } = await setUp()
    const bea = await givenAccount('Bea')
    await givenComing(bea.id)
    await love(server, bea.cookie, comment.id)

    await unlove(server, bea.cookie, comment.id)

    expect(await bell(server, ada.cookie)).toHaveLength(1)
  })

  it('says it again for a heart taken back and given afresh, which is a second heart', async () => {
    const { server, ada, comment } = await setUp()
    const bea = await givenAccount('Bea')
    await givenComing(bea.id)
    await love(server, bea.cookie, comment.id)

    await unlove(server, bea.cookie, comment.id)
    await love(server, bea.cookie, comment.id)

    expect(await bell(server, ada.cookie)).toHaveLength(2)
  })

  it('says nothing to somebody who has switched hearts off, and only that switch', async () => {
    const { server, ada, comment } = await setUp()
    const bea = await givenAccount('Bea')
    await givenComing(bea.id)
    await setOn(
      server,
      ada.cookie,
      notificationCategories.filter((category) => category !== 'hearted'),
    )

    await love(server, bea.cookie, comment.id)

    expect(await bell(server, ada.cookie)).toEqual([])
  })

  it('answers 404 for an entry that is not a comment, a done thing being nobody’s to love', async () => {
    const { server, ada, card } = await setUp()
    const [done] = (await entriesOf(server, ada.cookie, card)).filter((one) => one.kind !== 'comment')

    expect((await love(server, ada.cookie, done?.id ?? '')).statusCode).toBe(404)
  })
})

describe('the heart on a card', () => {
  const heart = (server: FastifyInstance, cookie: string, id: string) =>
    server.inject({ method: 'POST', url: `/api/threads/${id}/support/me`, headers: { cookie } })

  const unheart = (server: FastifyInstance, cookie: string, id: string) =>
    server.inject({ method: 'DELETE', url: `/api/threads/${id}/support/me`, headers: { cookie } })

  const cardOf = async (server: FastifyInstance, cookie: string): Promise<Thread> => {
    const [card] = (await server.inject({ method: 'GET', url: '/api/feed', headers: { cookie } })).json()
      .threads as Thread[]
    if (card === undefined) throw new Error('no card')

    return card
  }

  const announce = async (server: FastifyInstance, cookie: string, title: string) => {
    await server.inject({
      method: 'POST',
      url: `/api/events/${BURN}/posts`,
      headers: { cookie },
      payload: { title, body: '' },
    })

    return await cardOf(server, cookie)
  }

  it('counts a heart on a card that is not a dream, and says it is yours', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const card = await announce(server, ada.cookie, 'The planning call is Sunday')

    const hearted = await heart(server, ada.cookie, card.id)

    expect(hearted.statusCode).toBe(200)
    expect(hearted.json().thread.support_count).toBe(1)
    expect(hearted.json().thread.supported_by_me).toBe(true)
    expect(hearted.json().thread.supporters.map((one: { name: string }) => one.name)).toEqual(['Ada'])
  })

  it('takes it back again', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const card = await announce(server, ada.cookie, 'The planning call is Sunday')
    await heart(server, ada.cookie, card.id)

    const taken = await unheart(server, ada.cookie, card.id)

    expect(taken.json().thread.support_count).toBe(0)
    expect(taken.json().thread.supported_by_me).toBe(false)
  })

  it('counts one heart per person however often they press', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const card = await announce(server, ada.cookie, 'The planning call is Sunday')

    await heart(server, ada.cookie, card.id)
    const twice = await heart(server, ada.cookie, card.id)

    expect(twice.statusCode).toBe(200)
    expect(twice.json().thread.support_count).toBe(1)
  })

  it('says nothing is hearted where nobody has', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)

    const card = await announce(server, ada.cookie, 'The planning call is Sunday')

    expect([card.support_count, card.supported_by_me, card.supporters]).toEqual([0, false, []])
  })

  it('is the same heart a dream already had, not a second one beside it', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const { dream, thread: id } = await offerDream(server, ada.cookie, 'Sauna at dawn')

    await heart(server, ada.cookie, id)

    const listed = (
      await server.inject({
        method: 'GET',
        url: `/api/events/${BURN}/sessions`,
        headers: { cookie: ada.cookie },
      })
    ).json().sessions as { id: string; support_count: number; supported_by_me: boolean }[]
    expect(listed.find((one) => one.id === dream)).toMatchObject({
      support_count: 1,
      supported_by_me: true,
    })
  })

  it('refuses a withdrawn dream rather than writing a heart with nothing behind it', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const { dream, thread: id } = await offerDream(server, ada.cookie, 'Sauna at dawn')
    await sendGuarded((headers) =>
      server.inject({
        method: 'DELETE',
        url: `/api/sessions/${dream}`,
        headers: { cookie: ada.cookie, ...headers },
      }),
    )

    expect((await heart(server, ada.cookie, id)).statusCode).toBe(404)
  })

  it('refuses a dream to somebody not coming to that burn, as the dream’s own route does', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const away = await givenAccount('Cai')
    const { thread: id } = await offerDream(server, ada.cookie, 'Sauna at dawn')

    expect((await heart(server, away.cookie, id)).statusCode).toBe(403)
  })

  it('lets somebody not coming heart a song, which belongs to no burn', async () => {
    const server = await build()
    const away = await givenAccount('Cai')
    const made = await server.inject({
      method: 'POST',
      url: '/api/songs',
      headers: { cookie: away.cookie },
      payload: { title: 'Fire in the sky' },
    })
    const card = await cardOf(server, away.cookie)
    expect(made.statusCode).toBe(201)

    expect((await heart(server, away.cookie, card.id)).json().thread.support_count).toBe(1)
  })

  it('is refused to somebody signed out and to somebody with no role', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const nobody = await givenAccount('Nemo', [])
    const card = await announce(server, ada.cookie, 'The planning call is Sunday')

    expect(
      (await server.inject({ method: 'POST', url: `/api/threads/${card.id}/support/me` })).statusCode,
    ).toBe(401)
    expect((await heart(server, nobody.cookie, card.id)).statusCode).toBe(403)
  })

  it('is a 404 for a card that is not there', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')

    expect((await heart(server, ada.cookie, randomUUID())).statusCode).toBe(404)
  })

  it('tells whoever announced it, once however often it is pressed', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const bea = await givenAccount('Bea')
    await givenComing(bea.id)
    const card = await announce(server, ada.cookie, 'The planning call is Sunday')

    await heart(server, bea.cookie, card.id)
    await heart(server, bea.cookie, card.id)

    expect(await bell(server, ada.cookie)).toMatchObject([
      { category: 'hearted', body: 'Bea hearts The planning call is Sunday' },
    ])
  })

  it('tells whoever offered a dream, the offer being the only record of whose it is', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const bea = await givenAccount('Bea')
    await givenComing(bea.id)
    const { thread: id } = await offerDream(server, ada.cookie, 'Sauna at dawn')

    await heart(server, bea.cookie, id)

    expect(await bell(server, ada.cookie)).toMatchObject([
      { category: 'hearted', body: 'Bea hearts Sauna at dawn' },
    ])
  })

  it('says nothing for your own, on a card as on a comment', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const card = await announce(server, ada.cookie, 'The planning call is Sunday')

    await heart(server, ada.cookie, card.id)

    expect(await bell(server, ada.cookie)).toEqual([])
  })

  it('tells nobody about a sitting, which nobody wrote', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const card = await announce(server, ada.cookie, 'The planning call is Sunday')
    await db().update(thread).set({ entity_type: 'meal' }).where(eq(thread.id, card.id))

    expect((await heart(server, ada.cookie, card.id)).statusCode).toBe(200)
    expect(await bell(server, ada.cookie)).toEqual([])
  })
})

describe('following a card, and muting one', () => {
  const follow = (server: FastifyInstance, cookie: string, id: string, following: boolean) =>
    server.inject({
      method: 'PUT',
      url: `/api/threads/${id}/follow/me`,
      headers: { cookie },
      payload: { following },
    })

  it('reaches somebody who followed without ever saying anything', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    const cai = await givenAccount('Cai')
    for (const who of [ada, bea, cai]) await givenComing(who.id)
    const { thread: id } = await offerDream(server, ada.cookie, 'Sauna at dawn')

    await follow(server, cai.cookie, id, true)
    await say(server, bea.cookie, id, 'is one person enough?')

    expect((await bell(server, cai.cookie)).map((one) => one.category)).toEqual(['dream_comment'])
  })

  it('leaves somebody who muted it out, though they would otherwise be part of it', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    await givenComing(ada.id)
    await givenComing(bea.id)
    const { thread: id } = await offerDream(server, ada.cookie, 'Sauna at dawn')

    await follow(server, ada.cookie, id, false)
    await say(server, bea.cookie, id, 'is one person enough?')

    expect(await bell(server, ada.cookie)).toEqual([])
  })

  it('is silence, not a downgrade, for somebody who asked about every card of that kind', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    await givenComing(ada.id)
    await givenComing(bea.id)
    const { thread: id } = await offerDream(server, ada.cookie, 'Sauna at dawn')
    await setOn(server, ada.cookie, ['dream_comment_any'])

    await follow(server, ada.cookie, id, false)
    await say(server, bea.cookie, id, 'is one person enough?')

    expect(await bell(server, ada.cookie)).toEqual([])
  })

  it('still reaches that switch on a card nobody muted', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const bea = await givenAccount('Bea')
    const cai = await givenAccount('Cai')
    for (const who of [ada, bea, cai]) await givenComing(who.id)
    const { thread: id } = await offerDream(server, ada.cookie, 'Sauna at dawn')
    await setOn(server, cai.cookie, ['dream_comment_any'])

    await say(server, bea.cookie, id, 'is one person enough?')

    expect((await bell(server, cai.cookie)).map((one) => one.category)).toEqual(['dream_comment_any'])
  })

  it('says the effective state back, so the checkbox cannot claim one thing and do another', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const { thread: id } = await offerDream(server, ada.cookie, 'Sauna at dawn')

    expect((await read(server, id, ada.cookie)).json().thread.followed_by_me).toBe(true)
    expect((await follow(server, ada.cookie, id, false)).json().thread.followed_by_me).toBe(false)
    expect((await follow(server, ada.cookie, id, true)).json().thread.followed_by_me).toBe(true)
  })

  it('is unticked for somebody with nothing to do with the card', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    const cai = await givenAccount('Cai')
    await givenComing(ada.id)
    await givenComing(cai.id)
    const { thread: id } = await offerDream(server, ada.cookie, 'Sauna at dawn')

    expect((await read(server, id, cai.cookie)).json().thread.followed_by_me).toBe(false)
  })

  it('says nothing about following to somebody who is not asking', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const { thread: id } = await offerDream(server, ada.cookie, 'Sauna at dawn')

    expect((await follow(server, ada.cookie, randomUUID(), true)).statusCode).toBe(404)
    expect(
      (
        await server.inject({
          method: 'PUT',
          url: `/api/threads/${id}/follow/me`,
          payload: { following: true },
        })
      ).statusCode,
    ).toBe(401)
  })

  it('refuses a body that is not the one thing it takes', async () => {
    const server = await build()
    await givenBurn()
    const ada = await givenAccount('Ada')
    await givenComing(ada.id)
    const { thread: id } = await offerDream(server, ada.cookie, 'Sauna at dawn')

    expect((await follow(server, ada.cookie, id, 'yes' as unknown as boolean)).statusCode).toBe(400)
  })
})
