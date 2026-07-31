import type { FormQuestion } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { formQuestionTypes, tickBoxRequired } from '@sage-burner/shared'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole, formQuestion } from '../db/schema.ts'
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
    // The application form is public, so its questions are.
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
    // #12's acceptance, stated as a test: questions are rows, not code.
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
    // `order` is the server's to assign. It used to be stripped, which answered
    // 201 for a request that did not do what it asked — the same silent success
    // `.strict()` was added to the event schemas to kill.
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
    // `.nullable()` does not make a key optional, so omitting either was a bare
    // `bad_request` naming no field — and `options` is a column nothing consumes
    // yet.
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
    // The type exists because submission is blocked when it is unticked, so
    // `{ type: 'agreement', required: false }` contradicts itself. Rejected while
    // there are no rows, rather than leaving #14 to pick a half to believe.
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
    // A checkbox always has an answer, so "must be present" is vacuous and "must
    // be ticked" is what `agreement` means. Refusing the second spelling is what
    // stops #14 having to pick a reading.
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
    // This was live, not hypothetical. `formQuestionFields` gives `help_text` and
    // `options` a `.default(null)`, and `.partial()` does *not* suppress a default
    // in Zod 4 — so `{ label: 'New' }` parsed to
    // `{ label: 'New', help_text: null, options: null }` and every label edit
    // silently cleared the help text. The update schema is derived without the
    // defaults now: on a PATCH, absent means "leave it alone".
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
    // The other half: "absent means leave alone" must not become "you can never
    // clear it".
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
    // Same trap as the event PATCH: `set({})` is not valid SQL, so a typo'd
    // field name would answer `internal_error`.
    //
    // The row is read back, because the status alone does not test the "no-op"
    // half of the name. `{}` stays `{}` because the update schema carries no
    // defaults at all — it is built from the plain `formQuestionSchema`, not from
    // `formQuestionFields`, whose `.default(null)` on `help_text` and `options`
    // survives `.partial()` in Zod 4.
    //
    // Rebuilt from `formQuestionFields`, a `{}` body would parse to
    // `{ help_text: null, options: null }`: non-empty, so this guard is skipped,
    // `set()` is valid SQL, the response is still 200 — and every PATCH silently
    // wipes the help text. That is not hypothetical; it is the bug this test was
    // written for, and the read-back below is what catches it.
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

    // A typo is a 400 now, not a 200 that wrote nothing — `.strict()`, same as the
    // event schemas. Silent success is worse to diagnose than a refusal.
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
    // One field is enough to break the rule, and the schema only sees the body —
    // so the merged row is what has to hold. Both directions.
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
    // The other type, both directions. These reached the database CHECK and
    // answered 500 while the merged-row check covered only `agreement` — the
    // schema refine cannot catch them, since a body naming one of the two keys is
    // not decidable on its own.
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
    // The passing siblings. Every PATCH here carrying `type` or `required` asserted
    // a 400, so none of `tickBoxCondition`'s three returns had a success case — the
    // same gap that hid two defects in `dateOrderCondition`, and the reason
    // AGENTS.md now says a rejecting test needs a passing one.
    const server = await build()
    const cookie = await givenAdmin()

    // type-only, condition satisfied: a required `text` may become an `agreement`.
    const toAgreement = await add(server, cookie, { ...question, type: 'text', required: true })
    const agreed = await server.inject({
      method: 'PATCH',
      url: `/api/admin/questions/${toAgreement.json().question.id}`,
      headers: { cookie },
      payload: { type: 'agreement' },
    })
    expect(agreed.statusCode).toBe(200)
    expect(agreed.json().question).toMatchObject({ type: 'agreement', required: true })

    // required-only, satisfied: a `text` question may become optional.
    const toOptional = await add(server, cookie, { ...question, type: 'text', required: true })
    const optional = await server.inject({
      method: 'PATCH',
      url: `/api/admin/questions/${toOptional.json().question.id}`,
      headers: { cookie },
      payload: { required: false },
    })
    expect(optional.statusCode).toBe(200)
    expect(optional.json().question).toMatchObject({ type: 'text', required: false })

    // both keys, consistent: the third return, where the body settles it alone.
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
    // Driven by `formQuestionTypes` rather than naming the two types, so a third
    // one is covered the day it is added instead of needing a new test.
    //
    // Honest about its limits: this cannot discriminate the hardcoded version of
    // `tickBoxCondition`'s `required`-only branch, because hardcoding "true
    // conflicts with checkbox, false with agreement" *is* correct while those are
    // the only two tick-box types. Deriving from `tickBoxRequired` is future-proofing,
    // and no test today can prove it — this covers the surface it applies to.
    const server = await build()
    const cookie = await givenAdmin()

    for (const type of formQuestionTypes) {
      const must = tickBoxRequired(type)
      if (must === undefined) continue

      // create with the wrong value for the type
      const created = await add(server, cookie, {
        ...question,
        type,
        required: !must,
        label: `bad ${type}`,
      })
      expect(created.statusCode, `create ${type} required=${String(!must)}`).toBe(400)

      // PATCH the type onto a row whose `required` is wrong for it
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

      // PATCH `required` to the wrong value on a row already of that type
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
    // POST, DELETE and the reorder each had one; PATCH was the odd one out.
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
    // The delete's 404 comes from the write itself now (`.returning()`), and
    // nothing covered it: removing that branch left every test green, so a delete
    // of a missing question would have answered 204 as though it had done something.
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
    // `.strict()`, same as create and update: `{ ids: [...], oder: [...] }` would
    // otherwise strip the typo and reorder by whatever `ids` happened to hold.
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
    // #12's other acceptance criterion, end to end.
    const server = await build()
    const cookie = await givenAdmin()
    const [a, b, c] = await threeQuestions(server, cookie)

    const response = await reorder(server, cookie, [c ?? '', a ?? '', b ?? ''])

    expect(response.statusCode).toBe(200)
    expect(labelsOf(await publicList(server))).toEqual(['C', 'A', 'B'])
  })

  it('rejects a partial list rather than renumbering some rows', async () => {
    // Half a reorder is an order nobody chose: the named rows move and the rest
    // keep stale positions.
    const server = await build()
    const cookie = await givenAdmin()
    const [a, b] = await threeQuestions(server, cookie)

    const response = await reorder(server, cookie, [b ?? '', a ?? ''])

    expect(response.statusCode).toBe(400)
    expect(labelsOf(await publicList(server))).toEqual(['A', 'B', 'C'])
  })

  it('rejects a duplicate id, by way of the set check', async () => {
    // `[a, a, a]` against `{a, b, c}` is refused because `b` and `c` are missing,
    // not by a distinctness test — there is none, because with the lengths equal
    // and every existing id required, a duplicate cannot fit. Named so the next
    // reader does not go looking for the check this asserts the effect of.
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
