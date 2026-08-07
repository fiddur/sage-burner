import type { FastifyInstance, LightMyRequestResponse } from 'fastify'

import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { SESSION_COOKIE } from '../auth/viewer.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole, event, faqEntry } from '../db/schema.ts'
import { sendGuarded } from '../if-match.testing.ts'

/**
 * The Q&A the spreadsheet had a tab for (#28).
 *
 * What is worth proving here is what makes it different from the register beside
 * it: an entry may have **no answer**, because the person with the question is
 * rarely the person with the answer; the order is somebody's arrangement and
 * survives a copy; and every write is any approved member's, on an open burn.
 */

const SECRET = 'f'.repeat(40)
// Before the fixture burn, so the writes are to a burn that has not ended.
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

const givenAccount = async (roles: ('admin' | 'member')[] = ['member']) => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, password_hash: null, name: 'Ada', created_at: NOW })
  for (const role of roles) await db().insert(accountRole).values({ account_id: id, role })

  const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })
  return { id, cookie: `${SESSION_COOKIE}=${sessions.issue(id)}` }
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
    // The person with the question is rarely the person with the answer, so asking
    // is one field and the answer comes later and from somebody else.
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
    // The whole point of the split: this is the burn's shared furniture, and the
    // answer is worth more than the etiquette of who wrote the question.
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
    // The burn's shared furniture, like the lead-roles register and the lanes.
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
    // A finished burn's Q&A is the record of what was asked, and an id noted while
    // it was current should not still be a way to rewrite it.
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
    // The copy too. It checked existence alone at first, which would have seeded a
    // finished burn with rows nothing could afterwards touch.
    expect((await copy(server, ada.cookie, past, open)).statusCode).toBe(404)
  })

  it('still reads a finished burn’s, which is how it gets copied forward', async () => {
    // The passing sibling: the writes are closed, the record is not.
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

  /**
   * A burn that has **ended**, with questions written straight into the table.
   *
   * `givenPrevious` above dates its burn after `NOW` and has to: it seeds through the
   * route, and every write there needs an open burn. So the case the copy action exists
   * for — seed the next burn from the one that just finished — went untested (#323).
   */
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
    // The order is most of what the copy is for: this list is read top to bottom.
    const server = await build()
    const ada = await givenAccount()
    const past = await givenPrevious(server, ada.cookie)
    const next = await givenEvent('Autumn burn')

    const copied = await copy(server, ada.cookie, next, past)

    expect(copied.statusCode).toBe(201)
    // Tagged with the version a following guarded write has to quote, which is the
    // half `copyPlaces` does not do — and nothing else pins it.
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
    // #277: without it the client keeps the tag it has just invalidated, and its
    // second edit refuses itself with "somebody else changed this".
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
    // The CHECK, exercised by a write that skips the API — nothing above this could
    // tell whether the constraint exists.
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
    // The passing sibling: the refusal above is about the question, not the answer.
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
