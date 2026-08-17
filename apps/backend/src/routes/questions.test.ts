import type { FormQuestion } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { formQuestionTypes, tickBoxRequired } from '@sage-burner/shared'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { SESSION_COOKIE } from '../auth/viewer.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole, formQuestion } from '../db/schema.ts'

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

const question = {
  type: 'textarea' as const,
  label: 'Why do you want to come?',
  help_text: null,
  required: true,
  options: null,
}

const add = (server: FastifyInstance, cookie: string, body: Record<string, unknown>) =>
  server.inject({ method: 'POST', url: '/api/admin/questions', headers: { cookie }, payload: body })

const publicList = (server: FastifyInstance) => server.inject({ method: 'GET', url: '/api/questions' })

const reorder = (server: FastifyInstance, cookie: string, ids: string[]) =>
  server.inject({ method: 'PUT', url: '/api/admin/questions/order', headers: { cookie }, payload: { ids } })

const labelsOf = (response: { json: () => { questions: FormQuestion[] } }) =>
  response.json().questions.map((row) => row.label)

describe('the public question list', () => {
  it('is readable signed out', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    await add(server, cookie, question)

    const response = await publicList(server)

    expect(response.statusCode).toBe(200)
    expect(labelsOf(response)).toEqual(['Why do you want to come?'])
  })

  it('is empty before any question exists, rather than a 404', async () => {
    const server = await build()

    expect((await publicList(server)).json()).toEqual({ questions: [] })
  })

  it('shows a question added through the admin API, with no deploy', async () => {
    const server = await build()
    const cookie = await givenAdmin()

    expect(labelsOf(await publicList(server))).toEqual([])
    await add(server, cookie, { ...question, label: 'Added later' })

    expect(labelsOf(await publicList(server))).toEqual(['Added later'])
  })

  it('is marked no-cache so a new question is not hidden by a stale response', async () => {
    const server = await build()

    expect((await publicList(server)).headers['cache-control']).toBe('no-cache')
  })
})

describe('adding a question', () => {
  it('refuses an anonymous caller', async () => {
    const server = await build()

    const response = await server.inject({ method: 'POST', url: '/api/admin/questions', payload: question })

    expect(response.statusCode).toBe(401)
  })

  it('appends to the end', async () => {
    const server = await build()
    const cookie = await givenAdmin()

    await add(server, cookie, { ...question, label: 'First' })
    await add(server, cookie, { ...question, label: 'Second' })
    await add(server, cookie, { ...question, label: 'Third' })

    expect(labelsOf(await publicList(server))).toEqual(['First', 'Second', 'Third'])
  })

  it('refuses a client-supplied order rather than silently dropping it', async () => {
    const server = await build()
    const cookie = await givenAdmin()

    const response = await add(server, cookie, { ...question, label: 'Queue jumper', order: 0 })

    expect(response.statusCode).toBe(400)
    expect(labelsOf(await publicList(server))).toEqual([])
  })

  it('rejects a question with no label', async () => {
    const server = await build()
    const cookie = await givenAdmin()

    expect((await add(server, cookie, { ...question, label: '' })).statusCode).toBe(400)
  })

  it('accepts a create body that omits help_text and options', async () => {
    const server = await build()
    const cookie = await givenAdmin()

    const response = await add(server, cookie, {
      type: 'text',
      label: 'Your name',
      required: true,
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().question).toMatchObject({ help_text: null, options: null })
  })

  it('refuses an agreement question that is not required', async () => {
    const server = await build()
    const cookie = await givenAdmin()

    const response = await add(server, cookie, {
      ...question,
      type: 'agreement',
      required: false,
    })

    expect(response.statusCode).toBe(400)
    expect(labelsOf(await publicList(server))).toEqual([])
  })

  it('refuses a required checkbox, which is an agreement by another name', async () => {
    const server = await build()
    const cookie = await givenAdmin()

    const response = await add(server, cookie, {
      ...question,
      type: 'checkbox',
      required: true,
    })

    expect(response.statusCode).toBe(400)
    expect(labelsOf(await publicList(server))).toEqual([])
  })

  it('rejects an unknown question type', async () => {
    const server = await build()
    const cookie = await givenAdmin()

    expect((await add(server, cookie, { ...question, type: 'signature' })).statusCode).toBe(400)
  })
})

describe('editing a question', () => {
  const idOf = async (server: FastifyInstance, cookie: string, label: string) => {
    const created = await add(server, cookie, { ...question, label })
    return created.json().question.id
  }

  it('changes the label without restating the question', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    const id = await idOf(server, cookie, 'Old wording')

    const response = await server.inject({
      method: 'PATCH',
      url: `/api/admin/questions/${id}`,
      headers: { cookie },
      payload: { label: 'New wording' },
    })

    expect(response.statusCode).toBe(200)
    expect(labelsOf(await publicList(server))).toEqual(['New wording'])
  })

  it('leaves untouched fields alone', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    const id = await idOf(server, cookie, 'Question')

    await server.inject({
      method: 'PATCH',
      url: `/api/admin/questions/${id}`,
      headers: { cookie },
      payload: { help_text: 'A few sentences is plenty.' },
    })

    const [row] = await db().select().from(formQuestion).where(eq(formQuestion.id, id))
    expect(row).toMatchObject({ label: 'Question', required: true, type: 'textarea' })
  })

  it('does not wipe the help text when only the label is edited', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    const created = await add(server, cookie, {
      ...question,
      label: 'Old',
      help_text: 'A few sentences is plenty.',
    })
    const id = created.json().question.id

    await server.inject({
      method: 'PATCH',
      url: `/api/admin/questions/${id}`,
      headers: { cookie },
      payload: { label: 'New' },
    })

    const [row] = await db().select().from(formQuestion).where(eq(formQuestion.id, id))
    expect(row).toMatchObject({ label: 'New', help_text: 'A few sentences is plenty.' })
  })

  it('still clears the help text when null is sent deliberately', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    const created = await add(server, cookie, { ...question, help_text: 'remove me' })
    const id = created.json().question.id

    await server.inject({
      method: 'PATCH',
      url: `/api/admin/questions/${id}`,
      headers: { cookie },
      payload: { help_text: null },
    })

    const [row] = await db().select().from(formQuestion).where(eq(formQuestion.id, id))
    expect(row).toMatchObject({ help_text: null })
  })

  it('treats a body with no recognised keys as a no-op rather than a 500', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    const created = await add(server, cookie, {
      ...question,
      label: 'Question',
      help_text: 'kept',
    })
    const id = created.json().question.id

    const noOp = await server.inject({
      method: 'PATCH',
      url: `/api/admin/questions/${id}`,
      headers: { cookie },
      payload: {},
    })
    expect(noOp.statusCode).toBe(200)

    const typo = await server.inject({
      method: 'PATCH',
      url: `/api/admin/questions/${id}`,
      headers: { cookie },
      payload: { lable: 'typo' },
    })
    expect(typo.statusCode).toBe(400)

    const [row] = await db().select().from(formQuestion).where(eq(formQuestion.id, id))
    expect(row).toMatchObject({ label: 'Question', help_text: 'kept' })
  })

  it('refuses a patch that would make an agreement optional', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    const agreement = await add(server, cookie, {
      ...question,
      type: 'agreement',
      label: 'I agree',
    })
    const optional = await add(server, cookie, {
      ...question,
      type: 'text',
      label: 'Optional',
      required: false,
    })

    const unrequire = await server.inject({
      method: 'PATCH',
      url: `/api/admin/questions/${agreement.json().question.id}`,
      headers: { cookie },
      payload: { required: false },
    })
    const retype = await server.inject({
      method: 'PATCH',
      url: `/api/admin/questions/${optional.json().question.id}`,
      headers: { cookie },
      payload: { type: 'agreement' },
    })

    expect(unrequire.statusCode).toBe(400)
    expect(retype.statusCode).toBe(400)
  })

  it('refuses a patch that would make a checkbox required', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    const requiredText = await add(server, cookie, {
      ...question,
      type: 'text',
      label: 'Required text',
      required: true,
    })
    const checkbox = await add(server, cookie, {
      ...question,
      type: 'checkbox',
      label: 'Tick if vegan',
      required: false,
    })

    const retype = await server.inject({
      method: 'PATCH',
      url: `/api/admin/questions/${requiredText.json().question.id}`,
      headers: { cookie },
      payload: { type: 'checkbox' },
    })
    const require = await server.inject({
      method: 'PATCH',
      url: `/api/admin/questions/${checkbox.json().question.id}`,
      headers: { cookie },
      payload: { required: true },
    })

    expect(retype.statusCode).toBe(400)
    expect(retype.json()).toEqual({ error: 'bad_request' })
    expect(require.statusCode).toBe(400)
    expect(require.json()).toEqual({ error: 'bad_request' })
  })

  it('allows the tick-box changes that are legitimate, in all three shapes', async () => {
    const server = await build()
    const cookie = await givenAdmin()

    const toAgreement = await add(server, cookie, { ...question, type: 'text', required: true })
    const agreed = await server.inject({
      method: 'PATCH',
      url: `/api/admin/questions/${toAgreement.json().question.id}`,
      headers: { cookie },
      payload: { type: 'agreement' },
    })
    expect(agreed.statusCode).toBe(200)
    expect(agreed.json().question).toMatchObject({ type: 'agreement', required: true })

    const toOptional = await add(server, cookie, { ...question, type: 'text', required: true })
    const optional = await server.inject({
      method: 'PATCH',
      url: `/api/admin/questions/${toOptional.json().question.id}`,
      headers: { cookie },
      payload: { required: false },
    })
    expect(optional.statusCode).toBe(200)
    expect(optional.json().question).toMatchObject({ type: 'text', required: false })

    const toCheckbox = await add(server, cookie, { ...question, type: 'text', required: true })
    const both = await server.inject({
      method: 'PATCH',
      url: `/api/admin/questions/${toCheckbox.json().question.id}`,
      headers: { cookie },
      payload: { type: 'checkbox', required: false },
    })
    expect(both.statusCode).toBe(200)
    expect(both.json().question).toMatchObject({ type: 'checkbox', required: false })
  })

  it('applies the tick-box rule to every type the vocabulary defines', async () => {
    const server = await build()
    const cookie = await givenAdmin()

    for (const type of formQuestionTypes) {
      const must = tickBoxRequired(type)
      if (must === undefined) continue

      const created = await add(server, cookie, {
        ...question,
        type,
        required: !must,
        label: `bad ${type}`,
      })
      expect(created.statusCode, `create ${type} required=${String(!must)}`).toBe(400)

      const seed = await add(server, cookie, {
        ...question,
        type: 'text',
        required: !must,
        label: `seed ${type}`,
      })
      const retyped = await server.inject({
        method: 'PATCH',
        url: `/api/admin/questions/${seed.json().question.id}`,
        headers: { cookie },
        payload: { type },
      })
      expect(retyped.statusCode, `patch type to ${type}`).toBe(400)

      const typed = await add(server, cookie, {
        ...question,
        type,
        required: must,
        label: `typed ${type}`,
      })
      const flipped = await server.inject({
        method: 'PATCH',
        url: `/api/admin/questions/${typed.json().question.id}`,
        headers: { cookie },
        payload: { required: !must },
      })
      expect(flipped.statusCode, `patch required on ${type}`).toBe(400)
    }
  })

  it('refuses an anonymous patch', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    const created = await add(server, cookie, question)

    const response = await server.inject({
      method: 'PATCH',
      url: `/api/admin/questions/${created.json().question.id}`,
      payload: { label: 'hijacked' },
    })

    expect(response.statusCode).toBe(401)
    expect(labelsOf(await publicList(server))).toEqual(['Why do you want to come?'])
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
  it('answers 404 for a question that does not exist', async () => {
    const server = await build()
    const cookie = await givenAdmin()

    const response = await server.inject({
      method: 'DELETE',
      url: `/api/admin/questions/${randomUUID()}`,
      headers: { cookie },
    })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
  })

  it('removes it from the public form', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    await add(server, cookie, { ...question, label: 'Keep' })
    const drop = await add(server, cookie, { ...question, label: 'Drop' })

    const response = await server.inject({
      method: 'DELETE',
      url: `/api/admin/questions/${drop.json().question.id}`,
      headers: { cookie },
    })

    expect(response.statusCode).toBe(204)
    expect(labelsOf(await publicList(server))).toEqual(['Keep'])
  })

  it('refuses an anonymous caller', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    const created = await add(server, cookie, question)

    const response = await server.inject({
      method: 'DELETE',
      url: `/api/admin/questions/${created.json().question.id}`,
    })

    expect(response.statusCode).toBe(401)
  })
})

describe('reordering questions', () => {
  const threeQuestions = async (server: FastifyInstance, cookie: string) => {
    const ids: string[] = []
    for (const label of ['A', 'B', 'C']) {
      ids.push((await add(server, cookie, { ...question, label })).json().question.id)
    }
    return ids
  }

  it('rejects an unrecognised key in the reorder body', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    const [a, b, c] = await threeQuestions(server, cookie)

    const response = await server.inject({
      method: 'PUT',
      url: '/api/admin/questions/order',
      headers: { cookie },
      payload: { ids: [a ?? '', b ?? '', c ?? ''], oder: [] },
    })

    expect(response.statusCode).toBe(400)
    expect(labelsOf(await publicList(server))).toEqual(['A', 'B', 'C'])
  })

  it('changes the order on the public form', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    const [a, b, c] = await threeQuestions(server, cookie)

    const response = await reorder(server, cookie, [c ?? '', a ?? '', b ?? ''])

    expect(response.statusCode).toBe(200)
    expect(labelsOf(await publicList(server))).toEqual(['C', 'A', 'B'])
  })

  it('rejects a partial list rather than renumbering some rows', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    const [a, b] = await threeQuestions(server, cookie)

    const response = await reorder(server, cookie, [b ?? '', a ?? ''])

    expect(response.statusCode).toBe(400)
    expect(labelsOf(await publicList(server))).toEqual(['A', 'B', 'C'])
  })

  it('rejects a duplicate id, by way of the set check', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    const [a] = await threeQuestions(server, cookie)

    expect((await reorder(server, cookie, [a ?? '', a ?? '', a ?? ''])).statusCode).toBe(400)
  })

  it('refuses an anonymous caller', async () => {
    const server = await build()
    const cookie = await givenAdmin()
    const [a, b, c] = await threeQuestions(server, cookie)

    const response = await server.inject({
      method: 'PUT',
      url: '/api/admin/questions/order',
      payload: { ids: [c ?? '', b ?? '', a ?? ''] },
    })

    expect(response.statusCode).toBe(401)
    expect(labelsOf(await publicList(server))).toEqual(['A', 'B', 'C'])
  })
})
