import type { Thread } from '@sage-burner/shared'
import type { FastifyInstance, LightMyRequestResponse } from 'fastify'

import { faqPage } from '@sage-burner/shared'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { SESSION_COOKIE } from '../auth/viewer.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole, attendance, event, faqEntry, thread } from '../db/schema.ts'
import { sendGuarded } from '../if-match.testing.ts'
import { bell, cardOf, setOn } from './threads.testing.ts'

const SECRET = 'f'.repeat(40)
const NOW = '2026-07-02T00:00:00.000Z'

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
    now: () => new Date(NOW),
  })
  return app
}

const givenEvent = async (name = 'Summer burn', start = '2026-08-01') => {
  const id = randomUUID()
  await db()
    .insert(event)
    .values({
      id,
      name,
      slug: `burn-${id.slice(0, 8)}`,
      start_date: start,
      end_date: start,
      member_cap: 42,
      created_at: NOW,
    })
  return id
}

const givenAccount = async (roles: ('admin' | 'member')[] = ['member'], name = 'Ada') => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, password_hash: null, name, created_at: NOW })
  for (const role of roles) await db().insert(accountRole).values({ account_id: id, role })

  const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })
  return { id, cookie: `${SESSION_COOKIE}=${sessions.issue(id)}` }
}

const givenComing = async (accountId: string, eventId: string) => {
  await db()
    .insert(attendance)
    .values({ id: randomUUID(), event_id: eventId, account_id: accountId, joined_at: NOW })
}

const list = (server: FastifyInstance, cookie: string | undefined, eventId: string) =>
  server.inject({
    method: 'GET',
    url: `/api/events/${eventId}/faq`,
    headers: cookie === undefined ? {} : { cookie },
  })

const ask = (
  server: FastifyInstance,
  cookie: string | undefined,
  eventId: string,
  payload: Record<string, unknown> = { question: 'How do I get there?' },
): Promise<LightMyRequestResponse> =>
  server.inject({
    method: 'POST',
    url: `/api/events/${eventId}/faq`,
    headers: cookie === undefined ? {} : { cookie },
    payload,
  })

const edit = (server: FastifyInstance, cookie: string, id: string, payload: Record<string, unknown>) =>
  sendGuarded((extra) =>
    server.inject({ method: 'PATCH', url: `/api/faq/${id}`, headers: { cookie, ...extra }, payload }),
  )

const remove = (server: FastifyInstance, cookie: string | undefined, id: string) =>
  sendGuarded((extra) =>
    server.inject({
      method: 'DELETE',
      url: `/api/faq/${id}`,
      headers: cookie === undefined ? extra : { cookie, ...extra },
    }),
  )

const sort = (server: FastifyInstance, cookie: string, eventId: string, ids: string[]) =>
  sendGuarded((extra) =>
    server.inject({
      method: 'PUT',
      url: `/api/events/${eventId}/faq/order`,
      headers: { cookie, ...extra },
      payload: { ids },
    }),
  )

const copy = (server: FastifyInstance, cookie: string, eventId: string, from_event_id: string) =>
  server.inject({
    method: 'POST',
    url: `/api/events/${eventId}/faq/copy`,
    headers: { cookie },
    payload: { from_event_id },
  })

const questions = (response: LightMyRequestResponse): string[] =>
  response.json().entries.map((entry: { question: string }) => entry.question)

const faqCards = async (server: FastifyInstance, cookie: string): Promise<Thread[]> =>
  (await server.inject({ method: 'GET', url: '/api/feed?kinds=faq', headers: { cookie } })).json().threads

const lines = (card: Thread) => card.entries.map((entry) => [entry.kind, entry.author?.name, entry.body])

const say = (server: FastifyInstance, cookie: string, threadId: string, body: string) =>
  server.inject({
    method: 'POST',
    url: `/api/threads/${threadId}/comments`,
    headers: { cookie },
    payload: { body },
  })

describe('the burn’s Q&A', () => {
  it('is empty before anybody asks anything', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount()

    const response = await list(server, ada.cookie, eventId)

    expect(response.statusCode).toBe(200)
    expect(response.json().entries).toEqual([])
  })

  it('takes a question with no answer, which is the ordinary way one arrives', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount()

    const asked = await ask(server, ada.cookie, eventId)

    expect(asked.statusCode).toBe(201)
    expect(asked.json().entry).toMatchObject({ question: 'How do I get there?', answer: '', order: 0 })
  })

  it('refuses a question that is only spaces', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount()

    expect((await ask(server, ada.cookie, eventId, { question: '   ' })).statusCode).toBe(400)
  })

  it('puts each new question after the last, rather than all at zero', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount()

    await ask(server, ada.cookie, eventId, { question: 'First' })
    await ask(server, ada.cookie, eventId, { question: 'Second' })

    expect(questions(await list(server, ada.cookie, eventId))).toEqual(['First', 'Second'])
  })

  it('numbers each burn from zero rather than from the last burn’s total', async () => {
    const server = await build()
    const summer = await givenEvent('Summer burn')
    const winter = await givenEvent('Winter burn')
    const ada = await givenAccount()
    await ask(server, ada.cookie, summer, { question: 'Summer one' })

    const first = await ask(server, ada.cookie, winter, { question: 'Winter one' })

    expect(first.json().entry.order).toBe(0)
  })

  it('lets anybody answer a question somebody else asked', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount()
    const bea = await givenAccount()
    const asked = await ask(server, ada.cookie, eventId)

    const answered = await edit(server, bea.cookie, asked.json().entry.id, {
      answer: 'The **609** bus, then a walk.',
    })

    expect(answered.statusCode).toBe(200)
    expect(answered.json().entry.answer).toBe('The **609** bus, then a walk.')
  })

  it('treats an empty edit as a read rather than a 500', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount()
    const asked = await ask(server, ada.cookie, eventId)

    const answered = await edit(server, ada.cookie, asked.json().entry.id, {})

    expect(answered.statusCode).toBe(200)
    expect(answered.json().entry.question).toBe('How do I get there?')
  })

  it('rejects an unrecognised key instead of answering “saved”', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount()
    const asked = await ask(server, ada.cookie, eventId)

    expect((await edit(server, ada.cookie, asked.json().entry.id, { answr: 'typo' })).statusCode).toBe(400)
  })

  it('removes one and leaves the rest', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount()
    const first = await ask(server, ada.cookie, eventId, { question: 'First' })
    await ask(server, ada.cookie, eventId, { question: 'Second' })

    expect((await remove(server, ada.cookie, first.json().entry.id)).statusCode).toBe(204)
    expect(questions(await list(server, ada.cookie, eventId))).toEqual(['Second'])
  })

  it('reorders the whole list', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount()
    const first = await ask(server, ada.cookie, eventId, { question: 'First' })
    const second = await ask(server, ada.cookie, eventId, { question: 'Second' })

    const sorted = await sort(server, ada.cookie, eventId, [second.json().entry.id, first.json().entry.id])

    expect(sorted.statusCode).toBe(200)
    expect(questions(sorted)).toEqual(['Second', 'First'])
  })

  it('refuses an ordering that does not name every question exactly once', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount()
    const first = await ask(server, ada.cookie, eventId, { question: 'First' })
    await ask(server, ada.cookie, eventId, { question: 'Second' })

    expect((await sort(server, ada.cookie, eventId, [first.json().entry.id])).statusCode).toBe(400)
  })

  it('keeps each burn to its own questions', async () => {
    const server = await build()
    const summer = await givenEvent('Summer burn')
    const winter = await givenEvent('Winter burn')
    const ada = await givenAccount()
    await ask(server, ada.cookie, summer, { question: 'Summer one' })

    expect(questions(await list(server, ada.cookie, winter))).toEqual([])
  })
})

describe('who may write it', () => {
  it('is any approved member, admin or not', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const member = await givenAccount(['member'])

    expect((await ask(server, member.cookie, eventId)).statusCode).toBe(201)
  })

  it('refuses a stranger, and an account with no roles', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const nobody = await givenAccount([])

    expect((await list(server, undefined, eventId)).statusCode).toBe(401)
    expect((await ask(server, undefined, eventId)).statusCode).toBe(401)
    expect((await list(server, nobody.cookie, eventId)).statusCode).toBe(403)
    expect((await ask(server, nobody.cookie, eventId)).statusCode).toBe(403)
  })

  it('refuses every write once the burn has ended', async () => {
    const server = await build()
    const past = await givenEvent('Last summer', '2026-06-01')
    const ada = await givenAccount()
    const id = randomUUID()
    await db()
      .insert(faqEntry)
      .values({ id, event_id: past, question: 'Old one', answer: '', order: 0, created_at: NOW })

    const open = await givenEvent('Autumn burn')

    expect((await ask(server, ada.cookie, past)).statusCode).toBe(404)
    expect((await edit(server, ada.cookie, id, { answer: 'no' })).statusCode).toBe(404)
    expect((await remove(server, ada.cookie, id)).statusCode).toBe(404)
    expect((await sort(server, ada.cookie, past, [id])).statusCode).toBe(404)
    expect((await copy(server, ada.cookie, past, open)).statusCode).toBe(404)
  })

  it('still reads a finished burn’s, which is how it gets copied forward', async () => {
    const server = await build()
    const past = await givenEvent('Last summer', '2026-06-01')
    const ada = await givenAccount()
    await db().insert(faqEntry).values({
      id: randomUUID(),
      event_id: past,
      question: 'Old one',
      answer: '',
      order: 0,
      created_at: NOW,
    })

    expect(questions(await list(server, ada.cookie, past))).toEqual(['Old one'])
  })
})

describe('seeding it from a previous burn', () => {
  const givenPrevious = async (server: FastifyInstance, cookie: string) => {
    const past = await givenEvent('Last summer', '2026-07-03')
    await ask(server, cookie, past, { question: 'What do I bring?', answer: 'A sleeping bag.' })
    await ask(server, cookie, past, { question: 'How do I get there?' })
    return past
  }

  /** Straight into the table: `givenPrevious` seeds through the route, which needs an open burn. */
  const givenFinished = async () => {
    const over = await givenEvent('The burn that ended', '2026-06-01')
    await db()
      .insert(faqEntry)
      .values([
        {
          id: randomUUID(),
          event_id: over,
          question: 'What do I bring?',
          answer: 'A sleeping bag.',
          order: 0,
          created_at: NOW,
        },
        {
          id: randomUUID(),
          event_id: over,
          question: 'How do I get there?',
          answer: '',
          order: 1,
          created_at: NOW,
        },
      ])

    return over
  }

  it('copies out of a burn that has ended, which is the case it exists for', async () => {
    const server = await build()
    const ada = await givenAccount()
    const over = await givenFinished()
    const next = await givenEvent('Autumn burn')

    const copied = await copy(server, ada.cookie, next, over)

    expect(copied.statusCode).toBe(201)
    expect(questions(copied)).toEqual(['What do I bring?', 'How do I get there?'])
    expect(copied.json().entries[0].answer).toBe('A sleeping bag.')
  })

  it('copies the questions and their answers, in the order they were arranged', async () => {
    const server = await build()
    const ada = await givenAccount()
    const past = await givenPrevious(server, ada.cookie)
    const next = await givenEvent('Autumn burn')

    const copied = await copy(server, ada.cookie, next, past)

    expect(copied.statusCode).toBe(201)
    expect(copied.headers.etag).toBe((await list(server, ada.cookie, next)).headers.etag)
    expect(questions(copied)).toEqual(['What do I bring?', 'How do I get there?'])
    expect(copied.json().entries[0].answer).toBe('A sleeping bag.')
  })

  it('keeps the arrangement rather than the order they were written in', async () => {
    const server = await build()
    const ada = await givenAccount()
    const past = await givenPrevious(server, ada.cookie)
    const held = await list(server, ada.cookie, past)
    await sort(server, ada.cookie, past, [held.json().entries[1].id, held.json().entries[0].id])
    const next = await givenEvent('Autumn burn')

    expect(questions(await copy(server, ada.cookie, next, past))).toEqual([
      'How do I get there?',
      'What do I bring?',
    ])
  })

  it('refuses to copy into a list that already has questions', async () => {
    const server = await build()
    const ada = await givenAccount()
    const past = await givenPrevious(server, ada.cookie)
    const next = await givenEvent('Autumn burn')
    await ask(server, ada.cookie, next, { question: 'Already here' })

    expect((await copy(server, ada.cookie, next, past)).statusCode).toBe(409)
  })

  it('refuses a burn copying from itself', async () => {
    const server = await build()
    const ada = await givenAccount()
    const eventId = await givenEvent()

    expect((await copy(server, ada.cookie, eventId, eventId)).statusCode).toBe(400)
  })

  it('answers 404 for a burn that does not exist, either end', async () => {
    const server = await build()
    const ada = await givenAccount()
    const eventId = await givenEvent()

    expect((await copy(server, ada.cookie, randomUUID(), eventId)).statusCode).toBe(404)
    expect((await copy(server, ada.cookie, eventId, randomUUID())).statusCode).toBe(404)
  })

  it('offers only burns that have some, with how many', async () => {
    const server = await build()
    const ada = await givenAccount()
    const past = await givenPrevious(server, ada.cookie)
    await givenEvent('A burn with none')
    const next = await givenEvent('Autumn burn')

    const sources = await server.inject({
      method: 'GET',
      url: `/api/events/${next}/faq/sources`,
      headers: { cookie: ada.cookie },
    })

    expect(sources.json().sources).toEqual([{ event_id: past, name: 'Last summer', count: 2 }])
  })
})

describe('the precondition', () => {
  it('refuses a write quoting nothing at all, and says what the list holds', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount()
    const asked = await ask(server, ada.cookie, eventId)

    const bare = await server.inject({
      method: 'PATCH',
      url: `/api/faq/${asked.json().entry.id}`,
      headers: { cookie: ada.cookie },
      payload: { answer: 'no tag' },
    })

    expect(bare.statusCode).toBe(428)
    expect(bare.headers.etag).toBeTruthy()
  })

  it('answers a successful edit with the tag the next one must quote', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount()
    const first = await ask(server, ada.cookie, eventId)

    const saved = await edit(server, ada.cookie, first.json().entry.id, { answer: 'One.' })

    expect(saved.headers.etag).toBe((await list(server, ada.cookie, eventId)).headers.etag)

    const again = await server.inject({
      method: 'PATCH',
      url: `/api/faq/${first.json().entry.id}`,
      headers: { cookie: ada.cookie, 'if-match': String(saved.headers.etag) },
      payload: { answer: 'Two.' },
    })

    expect(again.statusCode).toBe(200)
  })

  it('refuses one quoting a version somebody has since moved past', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount()
    const asked = await ask(server, ada.cookie, eventId)
    const stale = (await list(server, ada.cookie, eventId)).headers.etag

    await edit(server, ada.cookie, asked.json().entry.id, { answer: 'first' })

    const second = await server.inject({
      method: 'PATCH',
      url: `/api/faq/${asked.json().entry.id}`,
      headers: { cookie: ada.cookie, 'if-match': String(stale) },
      payload: { answer: 'second' },
    })

    expect(second.statusCode).toBe(412)
  })
})

describe('what the database refuses on its own', () => {
  it('will not take a question of only spaces, whatever the caller', async () => {
    await build()
    const eventId = await givenEvent()

    expect(() =>
      client()
        .prepare(
          'insert into faq_entry (id, event_id, question, answer, "order", created_at) values (?,?,?,?,?,?)',
        )
        .run(randomUUID(), eventId, '   ', '', 0, NOW),
    ).toThrow(/CHECK constraint failed/i)
  })

  it('takes one with a question and no answer, by the same path', async () => {
    await build()
    const eventId = await givenEvent()

    expect(() =>
      client()
        .prepare(
          'insert into faq_entry (id, event_id, question, answer, "order", created_at) values (?,?,?,?,?,?)',
        )
        .run(randomUUID(), eventId, 'A real question', '', 0, NOW),
    ).not.toThrow()
  })

  it('goes when its burn does', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount()
    await ask(server, ada.cookie, eventId)

    client().exec('PRAGMA foreign_keys = ON')
    await db().delete(event).where(eq(event.id, eventId))

    expect(await db().select().from(faqEntry)).toEqual([])
  })
})

describe('a question on the feed', () => {
  const givenNobodysQuestion = async (eventId: string) => {
    const id = randomUUID()
    await db().insert(faqEntry).values({
      id,
      event_id: eventId,
      question: 'Is there a shower?',
      answer: '',
      order: 0,
      author_account_id: null,
      created_at: NOW,
    })

    return id
  }

  it('records who asked, and the list answers their name', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount()

    const asked = await ask(server, ada.cookie, eventId)
    const [listed] = (await list(server, ada.cookie, eventId)).json().entries

    expect(asked.json().entry).toMatchObject({ author_account_id: ada.id, author_name: 'Ada' })
    expect(listed).toMatchObject({ author_account_id: ada.id, author_name: 'Ada' })
  })

  it('opens a card on the feed headed by the question, with the asking line and a link to it', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount()

    const { entry } = (await ask(server, ada.cookie, eventId)).json()
    const [card] = await faqCards(server, ada.cookie)

    expect(card).toMatchObject({
      id: entry.thread_id,
      entity_type: 'faq',
      entity_id: entry.id,
      title: 'How do I get there?',
      link: faqPage(eventId, entry.id),
      body: null,
      own: true,
      followed_by_me: true,
    })
    expect(card === undefined ? [] : lines(card)).toEqual([['asked', 'Ada', 'asked this']])
  })

  it('rings every attendee’s bell but the asker’s, and not somebody who is not coming', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'], 'Ada')
    const bea = await givenAccount(['member'], 'Bea')
    const cid = await givenAccount(['member'], 'Cid')
    await givenComing(ada.id, eventId)
    await givenComing(bea.id, eventId)

    const { entry } = (await ask(server, ada.cookie, eventId)).json()

    expect(await bell(server, bea.cookie)).toMatchObject([
      { category: 'faq_asked', body: 'Ada asks: How do I get there?', link: faqPage(eventId, entry.id) },
    ])
    expect(await bell(server, ada.cookie)).toEqual([])
    expect(await bell(server, cid.cookie)).toEqual([])
  })

  it('rings nobody’s bell for a burn-wide question somebody has switched off', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'], 'Ada')
    const bea = await givenAccount(['member'], 'Bea')
    await givenComing(bea.id, eventId)
    await setOn(server, bea.cookie, [])

    await ask(server, ada.cookie, eventId)

    expect(await bell(server, bea.cookie)).toEqual([])
  })

  it('rings the asker’s bell when somebody answers, naming who answered', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'], 'Ada')
    const bea = await givenAccount(['member'], 'Bea')
    const { entry } = (await ask(server, ada.cookie, eventId)).json()

    await edit(server, bea.cookie, entry.id, { answer: 'The 609 bus.' })

    expect(await bell(server, ada.cookie)).toMatchObject([
      {
        category: 'faq_answered',
        body: 'Bea answered: How do I get there?',
        link: faqPage(eventId, entry.id),
      },
    ])
    expect(lines(await cardOf(server, ada.cookie, entry.thread_id))).toEqual([
      ['asked', 'Ada', 'asked this'],
      ['answered', 'Bea', 'answered this'],
    ])
  })

  it('never rings the asker’s bell for their own answer, and still records it on the card', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount()
    const { entry } = (await ask(server, ada.cookie, eventId)).json()

    await edit(server, ada.cookie, entry.id, { answer: 'Found it: the 609 bus.' })

    expect(await bell(server, ada.cookie)).toEqual([])
    expect(lines(await cardOf(server, ada.cookie, entry.thread_id))).toEqual([
      ['asked', 'Ada', 'asked this'],
      ['answered', 'Ada', 'answered this'],
    ])
  })

  it('does not ring again when the answer is reworded, and notes the rewording once', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'], 'Ada')
    const bea = await givenAccount(['member'], 'Bea')
    const { entry } = (await ask(server, ada.cookie, eventId)).json()

    await edit(server, bea.cookie, entry.id, { answer: 'The 609 bus.' })
    await edit(server, bea.cookie, entry.id, { answer: 'The 609 bus, then a walk.' })
    await edit(server, bea.cookie, entry.id, { answer: 'The 609 bus, then a short walk.' })

    expect(await bell(server, ada.cookie)).toHaveLength(1)
    expect(lines(await cardOf(server, ada.cookie, entry.thread_id))).toEqual([
      ['asked', 'Ada', 'asked this'],
      ['answered', 'Bea', 'answered this'],
      ['edited', 'Bea', 'went over it'],
    ])
  })

  it('answers a question nobody is recorded as asking without ringing a bell, and gives it a card', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const bea = await givenAccount(['member'], 'Bea')
    const cid = await givenAccount(['member'], 'Cid')
    await givenComing(cid.id, eventId)
    const id = await givenNobodysQuestion(eventId)

    const answered = await edit(server, bea.cookie, id, { answer: 'Yes, by the sauna.' })

    expect(answered.statusCode).toBe(200)
    expect(answered.json().entry).toMatchObject({ author_account_id: null, author_name: null })
    expect(await bell(server, cid.cookie)).toEqual([])
    expect(lines(await cardOf(server, bea.cookie, answered.json().entry.thread_id))).toEqual([
      ['answered', 'Bea', 'answered this'],
    ])
  })

  it('renames the card when the question is reworded', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount()
    const { entry } = (await ask(server, ada.cookie, eventId)).json()

    await edit(server, ada.cookie, entry.id, { question: 'How do I get there by train?' })

    const [held] = await db()
      .select({ title: thread.title })
      .from(thread)
      .where(eq(thread.id, entry.thread_id))
    const card = await cardOf(server, ada.cookie, entry.thread_id)

    expect(held?.title).toBe('How do I get there by train?')
    expect(card.title).toBe('How do I get there by train?')
    expect(lines(card)).toEqual([
      ['asked', 'Ada', 'asked this'],
      ['edited', 'Ada', 'went over it'],
    ])
  })

  it('carries the answer as the card’s body once there is one', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount()
    const { entry } = (await ask(server, ada.cookie, eventId)).json()

    expect((await cardOf(server, ada.cookie, entry.thread_id)).body).toBeNull()

    await edit(server, ada.cookie, entry.id, { answer: 'The **609** bus.' })

    expect((await cardOf(server, ada.cookie, entry.thread_id)).body).toBe('The **609** bus.')
  })

  it('tells whoever the answer newly names, rather than telling them twice', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'], 'Ada')
    const bea = await givenAccount(['member'], 'Bea')
    await givenComing(ada.id, eventId)
    const { entry } = (await ask(server, ada.cookie, eventId)).json()

    await edit(server, bea.cookie, entry.id, { answer: `Ask @[Ada](mention:${ada.id}), she drove it.` })

    expect(await bell(server, ada.cookie)).toMatchObject([
      {
        category: 'mentioned',
        body: 'Bea named you about: How do I get there?',
        link: faqPage(eventId, entry.id),
      },
    ])
  })

  it('reaches the asker and whoever answered with a comment, and somebody listening to every question', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'], 'Ada')
    const bea = await givenAccount(['member'], 'Bea')
    const cid = await givenAccount(['member'], 'Cid')
    const dan = await givenAccount(['member'], 'Dan')
    const eve = await givenAccount(['member'], 'Eve')
    for (const one of [ada, bea, cid, dan, eve]) await givenComing(one.id, eventId)
    await setOn(server, cid.cookie, ['faq_comment_any'])
    const { entry } = (await ask(server, ada.cookie, eventId)).json()
    await edit(server, bea.cookie, entry.id, { answer: 'The 609 bus.' })

    await say(server, dan.cookie, entry.thread_id, 'Or cycle, it is flat.')

    const about = async (cookie: string) =>
      (await bell(server, cookie))
        .filter((told) => told.body === 'Dan said something about How do I get there?')
        .map((told) => told.category)

    expect(await about(ada.cookie)).toEqual(['faq_comment'])
    expect(await about(bea.cookie)).toEqual(['faq_comment'])
    expect(await about(cid.cookie)).toEqual(['faq_comment_any'])
    expect(await about(eve.cookie)).toEqual([])
    expect(await about(dan.cookie)).toEqual([])
  })

  it('takes its card off the feed with it when the question is removed', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount()
    const { entry } = (await ask(server, ada.cookie, eventId)).json()

    await remove(server, ada.cookie, entry.id)

    expect(await faqCards(server, ada.cookie)).toEqual([])
    expect(await db().select().from(thread)).toEqual([])
  })

  it('gives every copied question a card and no asker, and rings nobody’s bell', async () => {
    const server = await build()
    const ada = await givenAccount(['member'], 'Ada')
    const bea = await givenAccount(['member'], 'Bea')
    const past = await givenEvent('Last summer', '2026-07-03')
    await ask(server, ada.cookie, past, { question: 'What do I bring?', answer: 'A sleeping bag.' })
    await ask(server, ada.cookie, past, { question: 'How do I get there?' })
    const next = await givenEvent('Autumn burn')
    await givenComing(ada.id, next)

    const copied = await copy(server, bea.cookie, next, past)
    const entries: { author_account_id: string | null; thread_id: string | null }[] = copied.json().entries

    expect(entries.map((entry) => entry.author_account_id)).toEqual([null, null])
    for (const entry of entries) {
      expect(entry.thread_id).not.toBeNull()
      expect(lines(await cardOf(server, bea.cookie, entry.thread_id ?? ''))).toEqual([
        ['added', 'Bea', 'brought this over from a previous burn'],
      ])
    }
    expect(await bell(server, ada.cookie)).toEqual([])
  })
})
