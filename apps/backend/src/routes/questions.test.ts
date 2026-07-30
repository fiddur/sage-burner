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

  it('accepts a create body that omits help_text and options', async () => {
    // `.nullable()` does not make a key optional, so omitting either was a bare
    // `bad_request` naming no field — and `options` is a column nothing consumes
    // yet.
    const server = await build()
    const cookie = await givenAdmin()
    const eventId = await givenEvent()

    const response = await add(server, cookie, eventId, {
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
    const eventId = await givenEvent()

    const response = await add(server, cookie, eventId, {
      ...question,
      type: 'agreement',
      required: false,
    })

    expect(response.statusCode).toBe(400)
    expect(labelsOf(await publicList(server, eventId))).toEqual([])
  })

  it('refuses a required checkbox, which is an agreement by another name', async () => {
    // A checkbox always has an answer, so "must be present" is vacuous and "must
    // be ticked" is what `agreement` means. Refusing the second spelling is what
    // stops #14 having to pick a reading.
    const server = await build()
    const cookie = await givenAdmin()
    const eventId = await givenEvent()

    const response = await add(server, cookie, eventId, {
      ...question,
      type: 'checkbox',
      required: true,
    })

    expect(response.statusCode).toBe(400)
    expect(labelsOf(await publicList(server, eventId))).toEqual([])
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

  it('does not wipe the help text when only the label is edited', async () => {
    // This was live, not hypothetical. `formQuestionFields` gives `help_text` and
    // `options` a `.default(null)`, and `.partial()` does *not* suppress a default
    // in Zod 4 — so `{ label: 'New' }` parsed to
    // `{ label: 'New', help_text: null, options: null }` and every label edit
    // silently cleared the help text. The update schema is derived without the
    // defaults now: on a PATCH, absent means "leave it alone".
    const server = await build()
    const cookie = await givenAdmin()
    const eventId = await givenEvent()
    const created = await add(server, cookie, eventId, {
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
    const eventId = await givenEvent()
    const created = await add(server, cookie, eventId, { ...question, help_text: 'remove me' })
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
    // half of the name. `formQuestionFields` gives `help_text` and `options` a
    // `.default(null)`, suppressed by `.partial()` — if that ever stopped holding,
    // `parsed.data` would be `{ help_text: null, options: null }` for a `{}` body:
    // non-empty, so this guard is skipped, `set()` is valid SQL, the response is
    // still 200, and every PATCH silently wipes the help text.
    const server = await build()
    const cookie = await givenAdmin()
    const eventId = await givenEvent()
    const created = await add(server, cookie, eventId, {
      ...question,
      label: 'Question',
      help_text: 'kept',
    })
    const id = created.json().question.id

    for (const payload of [{}, { lable: 'typo' }]) {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/admin/questions/${id}`,
        headers: { cookie },
        payload,
      })

      expect(response.statusCode, JSON.stringify(payload)).toBe(200)

      const [row] = await db().select().from(formQuestion).where(eq(formQuestion.id, id))
      expect(row, JSON.stringify(payload)).toMatchObject({ label: 'Question', help_text: 'kept' })
    }
  })

  it('refuses a patch that would make an agreement optional', async () => {
    // One field is enough to break the rule, and the schema only sees the body —
    // so the merged row is what has to hold. Both directions.
    const server = await build()
    const cookie = await givenAdmin()
    const eventId = await givenEvent()
    const agreement = await add(server, cookie, eventId, {
      ...question,
      type: 'agreement',
      label: 'I agree',
    })
    const optional = await add(server, cookie, eventId, {
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
    const eventId = await givenEvent()
    const requiredText = await add(server, cookie, eventId, {
      ...question,
      type: 'text',
      label: 'Required text',
      required: true,
    })
    const checkbox = await add(server, cookie, eventId, {
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

  it('refuses a patch whose read of the row is already stale', async () => {
    // The race, forced rather than hoped for. Two concurrent PATCHes each read
    // before either writes, so the loser decides against a row that no longer
    // looks like that — and with a read-then-check its UPDATE then trips
    // `form_question_checkbox_optional_check` and the caller gets a 500.
    //
    // `Promise.all` over two `inject`s does *not* reproduce it: they serialise, and
    // that version of this test passed against the buggy implementation. So the
    // stale read is injected directly: the handler is handed the row as it was
    // before a concurrent change, which is exactly what the loser of the race sees.
    const server = await build()
    const cookie = await givenAdmin()
    const eventId = await givenEvent()
    const created = await add(server, cookie, eventId, {
      ...question,
      type: 'text',
      label: 'Either way',
      required: false,
    })
    const id = created.json().question.id
    const [stale] = await db().select().from(formQuestion).where(eq(formQuestion.id, id))

    // The other request already landed: the row is a checkbox now, still valid.
    await db().update(formQuestion).set({ type: 'checkbox' }).where(eq(formQuestion.id, id))

    // Targeted by *table*, not by call index. Counting was the obvious approach and
    // it is branch-dependent: `requireAdmin` spends one select here and two on the
    // branch where `viewerFor` still uses `rolesFor`, so an index that is right in
    // one place stubs the guard's own query in the other and 500s for an unrelated
    // reason. Intercepting only reads of `form_question` leaves the guard alone.
    const live = db()
    const original = live.select.bind(live)
    let intercepted = 0
    live.select = ((...args: Parameters<typeof original>) => {
      const real = original(...args)

      return {
        from: (table: Parameters<typeof real.from>[0]) => {
          if (table !== formQuestion) return real.from(table)
          intercepted += 1

          return { where: () => ({ limit: () => Promise.resolve([stale]) }) }
        },
      }
    }) as typeof live.select

    const response = await server.inject({
      method: 'PATCH',
      url: `/api/admin/questions/${id}`,
      headers: { cookie },
      payload: { required: true },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'bad_request' })
    // The stub fired, so the 400 came from the stale-read path rather than from
    // the existence check above it.
    expect(intercepted).toBe(1)

    // And nothing was stored: the row is still a valid, optional checkbox.
    const [row] = await original({ type: formQuestion.type, required: formQuestion.required })
      .from(formQuestion)
      .where(eq(formQuestion.id, id))
    expect(row).toMatchObject({ type: 'checkbox', required: false })
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
    const eventId = await givenEvent()

    for (const type of formQuestionTypes) {
      const must = tickBoxRequired(type)
      if (must === undefined) continue

      // create with the wrong value for the type
      const created = await add(server, cookie, eventId, {
        ...question,
        type,
        required: !must,
        label: `bad ${type}`,
      })
      expect(created.statusCode, `create ${type} required=${String(!must)}`).toBe(400)

      // PATCH the type onto a row whose `required` is wrong for it
      const seed = await add(server, cookie, eventId, {
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
      const typed = await add(server, cookie, eventId, {
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
    const eventId = await givenEvent()
    const created = await add(server, cookie, eventId, question)

    const response = await server.inject({
      method: 'PATCH',
      url: `/api/admin/questions/${created.json().question.id}`,
      payload: { label: 'hijacked' },
    })

    expect(response.statusCode).toBe(401)
    expect(labelsOf(await publicList(server, eventId))).toEqual(['Why do you want to come?'])
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

    // Substituted for one of summer's own ids, not appended: with four ids
    // against three questions the length check answers first and the ownership
    // condition is never reached — deleting it from the route would leave this
    // test green.
    const response = await reorder(server, cookie, summer, [foreign.json().question.id, a ?? '', b ?? ''])

    expect(response.statusCode).toBe(400)
    expect(labelsOf(await publicList(server, winter))).toEqual(['Winter'])
    // And summer's own order is untouched, so the refusal was total.
    expect(labelsOf(await publicList(server, summer))).toEqual(['A', 'B', 'C'])
    expect(c ?? '').toBeTruthy()
  })

  it('answers 404 for an event that does not exist', async () => {
    // An empty id list satisfies set-equality against an empty read, so without an
    // existence probe this answered 200 — a successful reorder of a form that is
    // not there. `POST` under the same prefix already 404s for the same input.
    const server = await build()
    const cookie = await givenAdmin()

    const response = await reorder(server, cookie, randomUUID(), [])

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
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
