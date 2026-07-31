import type { FormQuestion } from '@sage-burner/shared'
import type { FastifyInstance, LightMyRequestResponse } from 'fastify'

import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { application, formQuestion } from '../db/schema.ts'

/**
 * Submitting the public application form.
 *
 * Unauthenticated by design — this is how someone who is not yet a member gets
 * in touch — so everything it accepts is attacker-controlled, and the two rules
 * worth proving are that the questions are honoured (a required one cannot be
 * skipped, an agreement cannot be left unticked) and that nothing the submitter
 * sends decides their own status.
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

const givenQuestion = async (over: Partial<FormQuestion> & Pick<FormQuestion, 'type'>) => {
  const id = randomUUID()
  await db()
    .insert(formQuestion)
    .values({
      id,
      order: over.order ?? 0,
      type: over.type,
      label: over.label ?? 'A question',
      help_text: over.help_text ?? null,
      required: over.required ?? false,
      options: over.options ?? null,
    })
  return id
}

const submit = (server: FastifyInstance, payload: Record<string, unknown>): Promise<LightMyRequestResponse> =>
  server.inject({ method: 'POST', url: '/api/applications', payload })

const applicant = { applicant_name: 'Fredrik', applicant_contact: 'fredrik@example.org' }

const stored = async () => db().select().from(application)

describe('submitting an application', () => {
  it('accepts a submission answering every question', async () => {
    const server = await build()
    const name = await givenQuestion({ type: 'text', label: 'Your name', required: true, order: 0 })
    const agree = await givenQuestion({ type: 'agreement', label: 'I agree', required: true, order: 1 })

    const response = await submit(server, {
      ...applicant,
      answers: { [name]: 'Fredrik', [agree]: true },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().application.status).toBe('pending')
  })

  it('stores the wording as asked, not just the question id', async () => {
    const server = await build()
    const id = await givenQuestion({ type: 'text', label: 'Why do you want to come?', required: true })

    await submit(server, { ...applicant, answers: { [id]: 'For the fire' } })
    await db().update(formQuestion).set({ label: 'Tell us about yourself' }).where(eq(formQuestion.id, id))

    const [row] = await stored()
    expect(row?.answers).toEqual([
      { question_id: id, label: 'Why do you want to come?', type: 'text', value: 'For the fire' },
    ])
  })

  it('keeps the answer readable after the question is deleted', async () => {
    const server = await build()
    const id = await givenQuestion({ type: 'text', label: 'Allergies?', required: false })

    await submit(server, { ...applicant, answers: { [id]: 'peanuts' } })
    await db().delete(formQuestion).where(eq(formQuestion.id, id))

    const [row] = await stored()
    expect(row?.answers).toEqual([{ question_id: id, label: 'Allergies?', type: 'text', value: 'peanuts' }])
  })

  it('records answers in the order the questions are asked', async () => {
    const server = await build()
    const second = await givenQuestion({ type: 'text', label: 'Second', order: 1 })
    const first = await givenQuestion({ type: 'text', label: 'First', order: 0 })

    await submit(server, { ...applicant, answers: { [second]: 'b', [first]: 'a' } })

    const [row] = await stored()
    expect(row?.answers.map((answer) => answer.label)).toEqual(['First', 'Second'])
  })

  it('refuses a submission skipping a required question', async () => {
    const server = await build()
    await givenQuestion({ type: 'text', label: 'Your name', required: true })

    const response = await submit(server, { ...applicant, answers: {} })

    expect(response.statusCode).toBe(400)
    expect(await stored()).toHaveLength(0)
  })

  it('refuses a submission with an unticked agreement', async () => {
    const server = await build()
    const agree = await givenQuestion({ type: 'agreement', label: 'I agree', required: true })

    const response = await submit(server, { ...applicant, answers: { [agree]: false } })

    expect(response.statusCode).toBe(400)
    expect(await stored()).toHaveLength(0)
  })

  it('refuses an agreement omitted rather than sent as false', async () => {
    // A browser omits an unticked box entirely, so this is the shape the rule
    // actually meets — checking only for `false` would let it through.
    const server = await build()
    await givenQuestion({ type: 'agreement', label: 'I agree', required: true })

    expect((await submit(server, { ...applicant, answers: {} })).statusCode).toBe(400)
  })

  it('refuses an answer to a question that was never asked', async () => {
    const server = await build()

    const response = await submit(server, { ...applicant, answers: { [randomUUID()]: 'x' } })

    expect(response.statusCode).toBe(400)
  })

  it('refuses a boolean answer to a text question', async () => {
    const server = await build()
    const id = await givenQuestion({ type: 'text', label: 'Your name', required: true })

    expect((await submit(server, { ...applicant, answers: { [id]: true } })).statusCode).toBe(400)
  })

  it('refuses a status the submitter tries to set', async () => {
    // `.strict()`, so this is a 400 rather than a silent drop — a submitter who
    // could set their own status would approve themselves.
    const server = await build()

    const response = await submit(server, { ...applicant, answers: {}, status: 'approved' })

    expect(response.statusCode).toBe(400)
    expect(await stored()).toHaveLength(0)
  })

  it('requires a name and a contact', async () => {
    const server = await build()

    expect((await submit(server, { applicant_contact: 'a@b.c', answers: {} })).statusCode).toBe(400)
    expect((await submit(server, { applicant_name: 'Fredrik', answers: {} })).statusCode).toBe(400)
    expect(
      (await submit(server, { applicant_name: '  ', applicant_contact: 'a@b.c', answers: {} })).statusCode,
    ).toBe(400)
  })

  it('accepts a form with no questions yet', async () => {
    const server = await build()

    expect((await submit(server, { ...applicant, answers: {} })).statusCode).toBe(201)
  })

  it('stores an unticked checkbox as false rather than dropping it', async () => {
    const server = await build()
    const box = await givenQuestion({ type: 'checkbox', label: 'Bring food', required: false })

    await submit(server, { ...applicant, answers: {} })

    const [row] = await stored()
    expect(row?.answers).toEqual([{ question_id: box, label: 'Bring food', type: 'checkbox', value: false }])
  })

  it('does not let a submitter choose their own id', async () => {
    const server = await build()
    const chosen = randomUUID()

    expect((await submit(server, { ...applicant, answers: {}, id: chosen })).statusCode).toBe(400)
  })

  it('is open to the public, with no session', async () => {
    // Explicit, because every other write in this app requires an admin — the
    // absence of a guard here is a decision, not an oversight.
    const server = await build()

    const response = await submit(server, { ...applicant, answers: {} })

    expect(response.statusCode).toBe(201)
  })
})
