import type { FormQuestion } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole, event, formQuestion } from '../db/schema.ts'
import { SESSION_COOKIE } from './auth.ts'

/**
 * The application form's questions.
 *
 * The property that matters most is the one #12 exists for: the questions are
 * data, so an organiser changes them without a deploy and the public form
 * reflects it. Everything here is written against that.
 */

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
    .values({
      id,
      email: `${id}@example.org`,
      password_hash: null,
      created_at: '2026-01-01T00:00:00.000Z',
    })
  await db().insert(accountRole).values({ account_id: id, role: 'admin' })

  const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })
  return `${SESSION_COOKIE}=${sessions.issue(id)}`
}

const givenEvent = async (slug = 'summer-2026') => {
  const id = randomUUID()
  await db().insert(event).values({
    id,
    name: slug,
    slug,
    start_date: '2099-08-01',
    end_date: '2099-08-05',
    welcome_markdown: '',
    member_cap: 42,
    created_at: '2026-01-01T00:00:00.000Z',
  })
  return id
}

const question = {
  type: 'textarea' as const,
  label: 'Why do you want to come?',
  help_text: null,
  required: true,
  options: null,
}

const add = (server: FastifyInstance, cookie: string, eventId: string, body: Record<string, unknown>) =>
  server.inject({
    method: 'POST',
    url: `/api/admin/events/${eventId}/questions`,
    headers: { cookie },
    payload: body,
  })

const publicList = (server: FastifyInstance, eventId: string) =>
  server.inject({ method: 'GET', url: `/api/events/${eventId}/questions` })

const reorder = (server: FastifyInstance, cookie: string, eventId: string, ids: string[]) =>
  server.inject({
    method: 'PUT',
    url: `/api/admin/events/${eventId}/questions/order`,
    headers: { cookie },
    payload: { ids },
  })

const labelsOf = (response: { json: () => { questions: FormQuestion[] } }) =>
  response.json().questions.map((row) => row.label)

describe('the public question list', () => {
  it('is readable signed out', async () => {
    // The application form is public, so its questions are.
    const server = await build()
    const cookie = await givenAdmin()
    const eventId = await givenEvent()
    await add(server, cookie, eventId, question)

    const response = await publicList(server, eventId)

    expect(response.statusCode).toBe(200)
    expect(labelsOf(response)).toEqual(['Why do you want to come?'])
  })

  it('is empty for an event with no questions rather than a 404', async () => {
    const server = await build()
    const eventId = await givenEvent()

    expect((await publicList(server, eventId)).json()).toEqual({ questions: [] })
  })

  it('shows a question added through the admin API, with no deploy', async () => {
    // #12's acceptance, stated as a test: questions are rows, not code.
    const server = await build()
    const cookie = await givenAdmin()
    const eventId = await givenEvent()

    expect(labelsOf(await publicList(server, eventId))).toEqual([])
    await add(server, cookie, eventId, { ...question, label: 'Added later' })

    expect(labelsOf(await publicList(server, eventId))).toEqual(['Added later'])
  })

  it('only lists the questions of the event asked for', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    const summer = await givenEvent('summer-2026')
    const winter = await givenEvent('winter-2026')
    await add(server, cookie, summer, { ...question, label: 'Summer question' })
    await add(server, cookie, winter, { ...question, label: 'Winter question' })

    expect(labelsOf(await publicList(server, summer))).toEqual(['Summer question'])
  })

  it('is marked no-cache so a new question is not hidden by a stale response', async () => {
    const server = await build()
    const eventId = await givenEvent()

    expect((await publicList(server, eventId)).headers['cache-control']).toBe('no-cache')
  })
})

describe('adding a question', () => {
  it('refuses an anonymous caller', async () => {
    const server = await build()
    const eventId = await givenEvent()

    const response = await server.inject({
      method: 'POST',
      url: `/api/admin/events/${eventId}/questions`,
      payload: question,
    })

    expect(response.statusCode).toBe(401)
  })

  it('appends to the end rather than trusting a client-supplied order', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    const eventId = await givenEvent()

    await add(server, cookie, eventId, { ...question, label: 'First' })
    await add(server, cookie, eventId, { ...question, label: 'Second' })
    // `order` is not part of the create schema, so this key is stripped — the
    // point being that a client cannot jump the queue.
    await add(server, cookie, eventId, { ...question, label: 'Third', order: 0 })

    expect(labelsOf(await publicList(server, eventId))).toEqual(['First', 'Second', 'Third'])
  })

  it('answers 404 for an event that does not exist', async () => {
    // The foreign key would raise a constraint error and answer 500; "no such
    // event" is a 404.
    const server = await build()
    const cookie = await givenAdmin()

    expect((await add(server, cookie, randomUUID(), question)).statusCode).toBe(404)
  })

  it('rejects a question with no label', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    const eventId = await givenEvent()

    expect((await add(server, cookie, eventId, { ...question, label: '' })).statusCode).toBe(400)
  })

  it('rejects an unknown question type', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    const eventId = await givenEvent()

    expect((await add(server, cookie, eventId, { ...question, type: 'signature' })).statusCode).toBe(400)
  })
})

describe('editing a question', () => {
  const idOf = async (server: FastifyInstance, cookie: string, eventId: string, label: string) => {
    const created = await add(server, cookie, eventId, { ...question, label })
    return created.json().question.id
  }

  it('changes the label without restating the question', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    const eventId = await givenEvent()
    const id = await idOf(server, cookie, eventId, 'Old wording')

    const response = await server.inject({
      method: 'PATCH',
      url: `/api/admin/questions/${id}`,
      headers: { cookie },
      payload: { label: 'New wording' },
    })

    expect(response.statusCode).toBe(200)
    expect(labelsOf(await publicList(server, eventId))).toEqual(['New wording'])
  })

  it('leaves untouched fields alone', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    const eventId = await givenEvent()
    const id = await idOf(server, cookie, eventId, 'Question')

    await server.inject({
      method: 'PATCH',
      url: `/api/admin/questions/${id}`,
      headers: { cookie },
      payload: { help_text: 'A few sentences is plenty.' },
    })

    const [row] = await db().select().from(formQuestion).where(eq(formQuestion.id, id))
    expect(row).toMatchObject({ label: 'Question', required: true, type: 'textarea' })
  })

  it('treats a body with no recognised keys as a no-op rather than a 500', async () => {
    // Same trap as the event PATCH: `set({})` is not valid SQL, so a typo'd
    // field name would answer `internal_error`.
    const server = await build()
    const cookie = await givenAdmin()
    const eventId = await givenEvent()
    const id = await idOf(server, cookie, eventId, 'Question')

    for (const payload of [{}, { lable: 'typo' }]) {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/admin/questions/${id}`,
        headers: { cookie },
        payload,
      })

      expect(response.statusCode, JSON.stringify(payload)).toBe(200)
    }
  })

  it('answers 404 for a question that does not exist', async () => {
    const server = await build()
    const cookie = await givenAdmin()

    const response = await server.inject({
      method: 'PATCH',
      url: `/api/admin/questions/${randomUUID()}`,
      headers: { cookie },
      payload: { label: 'x' },
    })

    expect(response.statusCode).toBe(404)
  })
})

describe('deleting a question', () => {
  it('removes it from the public form', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    const eventId = await givenEvent()
    const keep = await add(server, cookie, eventId, { ...question, label: 'Keep' })
    const drop = await add(server, cookie, eventId, { ...question, label: 'Drop' })

    const response = await server.inject({
      method: 'DELETE',
      url: `/api/admin/questions/${drop.json().question.id}`,
      headers: { cookie },
    })

    expect(response.statusCode).toBe(204)
    expect(labelsOf(await publicList(server, eventId))).toEqual(['Keep'])
    expect(keep.json().question.id).toBeTruthy()
  })

  it('refuses an anonymous caller', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    const eventId = await givenEvent()
    const created = await add(server, cookie, eventId, question)

    const response = await server.inject({
      method: 'DELETE',
      url: `/api/admin/questions/${created.json().question.id}`,
    })

    expect(response.statusCode).toBe(401)
  })
})

describe('reordering questions', () => {
  const threeQuestions = async (server: FastifyInstance, cookie: string, eventId: string) => {
    const ids: string[] = []
    for (const label of ['A', 'B', 'C']) {
      ids.push((await add(server, cookie, eventId, { ...question, label })).json().question.id)
    }
    return ids
  }

  it('changes the order on the public form', async () => {
    // #12's other acceptance criterion, end to end.
    const server = await build()
    const cookie = await givenAdmin()
    const eventId = await givenEvent()
    const [a, b, c] = await threeQuestions(server, cookie, eventId)

    const response = await reorder(server, cookie, eventId, [c ?? '', a ?? '', b ?? ''])

    expect(response.statusCode).toBe(200)
    expect(labelsOf(await publicList(server, eventId))).toEqual(['C', 'A', 'B'])
  })

  it('rejects a partial list rather than renumbering some rows', async () => {
    // Half a reorder is an order nobody chose: the named rows move and the rest
    // keep stale positions.
    const server = await build()
    const cookie = await givenAdmin()
    const eventId = await givenEvent()
    const [a, b] = await threeQuestions(server, cookie, eventId)

    const response = await reorder(server, cookie, eventId, [b ?? '', a ?? ''])

    expect(response.statusCode).toBe(400)
    expect(labelsOf(await publicList(server, eventId))).toEqual(['A', 'B', 'C'])
  })

  it('rejects a duplicate id', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    const eventId = await givenEvent()
    const [a] = await threeQuestions(server, cookie, eventId)

    expect((await reorder(server, cookie, eventId, [a ?? '', a ?? '', a ?? ''])).statusCode).toBe(400)
  })

  it('rejects a question belonging to another event', async () => {
    // Otherwise a reorder silently moves a question off a form it belongs to.
    const server = await build()
    const cookie = await givenAdmin()
    const summer = await givenEvent('summer-2026')
    const winter = await givenEvent('winter-2026')
    const [a, b, c] = await threeQuestions(server, cookie, summer)
    const foreign = await add(server, cookie, winter, { ...question, label: 'Winter' })

    const response = await reorder(server, cookie, summer, [
      foreign.json().question.id,
      a ?? '',
      b ?? '',
      c ?? '',
    ])

    expect(response.statusCode).toBe(400)
    expect(labelsOf(await publicList(server, winter))).toEqual(['Winter'])
  })

  it('refuses an anonymous caller', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    const eventId = await givenEvent()
    const [a, b, c] = await threeQuestions(server, cookie, eventId)

    const response = await server.inject({
      method: 'PUT',
      url: `/api/admin/events/${eventId}/questions/order`,
      payload: { ids: [c ?? '', b ?? '', a ?? ''] },
    })

    expect(response.statusCode).toBe(401)
    expect(labelsOf(await publicList(server, eventId))).toEqual(['A', 'B', 'C'])
  })
})
