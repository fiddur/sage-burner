import type { FormQuestion } from '@sage-burner/shared'
import type { FastifyInstance, LightMyRequestResponse } from 'fastify'

import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DbHandle } from '../db/index.ts'
import type { Delivery } from '../push/push.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { SESSION_COOKIE } from '../auth/viewer.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import {
  account,
  accountRole,
  application,
  formQuestion,
  notification,
  pushSubscription,
} from '../db/schema.ts'

/**
 * Submitting the application form.
 *
 * Behind being signed in since #476 — the account comes first and the application second — but
 * a role-less account is what anybody off the street can make, so everything it accepts is still
 * attacker-controlled. The rules worth proving are that the questions are honoured (a required
 * one cannot be skipped, an agreement cannot be left unticked) and that nothing the submitter
 * sends decides their own status.
 */

const SECRET = 's'.repeat(40)
const NOW = '2026-07-02T00:00:00.000Z'

let handle: DbHandle | undefined
let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  handle?.close()
  app = undefined
  handle = undefined
  applicantAccount = undefined
})

const build = async (deliver: Delivery = () => Promise.resolve('sent')) => {
  handle = createDb({ url: ':memory:' })
  runMigrations(handle)
  app = await createApp({
    db: handle.db,
    config: createConfig({ LOG_LEVEL: 'silent', SESSION_SECRET: SECRET }),
    deliver,
    mintKeys: () => ({ publicKey: 'a-public-key', privateKey: 'a-private-key' }),
  })
  await givenApplicant()

  return app
}

/** An admin with a browser signed up for push, which is who an application reaches. */
const givenSubscribedAdmin = async () => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, password_hash: null, created_at: NOW })
  await db().insert(accountRole).values({ account_id: id, role: 'admin' })
  await db()
    .insert(pushSubscription)
    .values({
      id: randomUUID(),
      endpoint: `https://push.example.org/${randomUUID()}`,
      account_id: id,
      p256dh: 'a-key',
      auth: 'a-secret',
      created_at: NOW,
    })

  return id
}

const db = () => {
  const found = handle?.db
  if (found === undefined) throw new Error('build() first')
  return found
}

const givenQuestion = async (over: Partial<FormQuestion> & Pick<FormQuestion, 'type'>) => {
  const id = over.id ?? randomUUID()
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

/**
 * The answer keys, or none.
 *
 * `payload` is `Record<string, unknown>`, so `payload.answers` is `unknown` and
 * cannot go to `Object.keys` without narrowing. Guarded rather than cast, and the
 * `[]` is what a test passing a non-object `answers` would want anyway: casting
 * would turn a string into `asked: ['0','1',…]` and quietly rewrite the body of a
 * test that meant to probe something else.
 */
const answerKeys = (answers: unknown): string[] =>
  typeof answers === 'object' && answers !== null ? Object.keys(answers) : []

/**
 * Submit, defaulting `asked` to whatever the answers name.
 *
 * The field is required by the schema, and spelling it out in every test that is
 * not about it would bury the thing each one is asserting. Tests that care pass
 * it explicitly.
 */
const submit = (
  server: FastifyInstance,
  payload: Record<string, unknown>,
  cookie?: string,
): Promise<LightMyRequestResponse> =>
  server.inject({
    method: 'POST',
    url: '/api/applications',
    headers: { cookie: cookie ?? applicantCookie() },
    payload: { asked: answerKeys(payload.answers), ...payload },
  })

/**
 * The account an applicant has before they have a role, made on the way in. Held in a module
 * variable rather than threaded through every test: the tests here are about the form, and the
 * account is furniture the flow now requires.
 */
let applicantAccount: { id: string; cookie: string } | undefined

const applicantCookie = () => {
  if (applicantAccount === undefined) throw new Error('givenApplicant() first')
  return applicantAccount.cookie
}

const givenSignedIn = async (roles: ('admin' | 'member')[] = []) => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, password_hash: null, created_at: NOW })
  for (const role of roles) await db().insert(accountRole).values({ account_id: id, role })

  const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })

  return { id, cookie: `${SESSION_COOKIE}=${sessions.issue(id)}` }
}

/**
 * Only the first call becomes the one `submit()` uses by default — a second would
 * otherwise repoint it, and a test mixing the two would fail somewhere else entirely.
 */
const givenApplicant = async () => {
  const made = await givenSignedIn()
  applicantAccount ??= made

  return made
}

const applicant = { applicant_name: 'Fredrik', applicant_email: 'fredrik@example.org' }

const stored = async () => db().select().from(application)

/** Submit an answer, with the question's wording edited in between. */
const submitAfter = async (server: FastifyInstance, questionId: string, label: string) => {
  await db().update(formQuestion).set({ label }).where(eq(formQuestion.id, questionId))
  return submit(server, { ...applicant, answers: { [questionId]: 'For the fire' }, asked: [questionId] })
}

describe('how often an applicant may ring every admin', () => {
  it('refuses past its allowance, each message being a fan-out to every admin (#489)', async () => {
    const server = await build()
    await givenSubscribedAdmin()
    const who = await givenApplicant()
    const filed = await submit(server, { ...applicant, answers: {} }, who.cookie)
    expect(filed.statusCode, 'the application must exist for the thread to answer 200').toBe(201)

    const say = () =>
      server.inject({
        method: 'POST',
        url: '/api/me/application/messages',
        headers: { cookie: who.cookie },
        payload: { body: 'hello' },
      })

    const codes: number[] = []
    for (let at = 0; at < 12; at += 1) codes.push((await say()).statusCode)

    expect(codes.filter((code) => code === 429).length).toBeGreaterThan(0)
    expect(codes[0]).toBe(200)
  })
})

describe('somebody who is already a member', () => {
  it('cannot file an application, having nothing left to apply for (#489)', async () => {
    const server = await build()
    const member = await givenSignedIn(['member'])

    const sent = await server.inject({
      method: 'POST',
      url: '/api/applications',
      headers: { cookie: member.cookie },
      payload: { ...applicant, answers: {}, asked: [] },
    })

    expect(sent.statusCode).toBe(409)
  })
})

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

  it('records answers in the same order the public form serves them', async () => {
    // `order` is not unique, so a tie is broken by id — and it has to be broken
    // the same way in both places, or the applicant sees one order and the
    // stored snapshot records another.
    const server = await build()
    const first = '00000000-0000-4000-8000-000000000001'
    const second = '00000000-0000-4000-8000-000000000002'
    await givenQuestion({ id: second, type: 'text', label: 'Second', order: 0 })
    await givenQuestion({ id: first, type: 'text', label: 'First', order: 0 })

    await submit(server, { ...applicant, answers: { [second]: 'b', [first]: 'a' } })

    const served = (await server.inject({ method: 'GET', url: '/api/questions' })).json()
    const [row] = await stored()
    const storedOrder = row?.answers.map((answer) => answer.question_id)

    expect(storedOrder).toEqual(served.questions.map((question: { id: string }) => question.id))
    // Both halves: that the two agree, and that they agree on id — sharing one
    // query makes them agree on anything, including nothing in particular.
    expect(storedOrder).toEqual([first, second])
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

    expect((await submit(server, { applicant_email: 'a@b.c', answers: {} })).statusCode).toBe(400)
    expect((await submit(server, { applicant_name: 'Fredrik', answers: {} })).statusCode).toBe(400)
    expect(
      (await submit(server, { applicant_name: '  ', applicant_email: 'a@b.c', answers: {} })).statusCode,
    ).toBe(400)
  })

  it('accepts a form with no questions yet', async () => {
    const server = await build()

    expect((await submit(server, { ...applicant, answers: {} })).statusCode).toBe(201)
  })

  it('stores the wording as it is at submission, not as it was on screen', async () => {
    // The one thing still read from the current list rather than from `asked`: a
    // label edited while the form was open is stored as the new text, against an
    // answer given to the old.
    const server = await build()
    const why = await givenQuestion({ type: 'text', label: 'Why?', required: false })
    await submitAfter(server, why, 'Why do you want to come?')

    const [row] = await stored()
    expect(row?.answers).toEqual([
      { question_id: why, label: 'Why do you want to come?', type: 'text', value: 'For the fire' },
    ])
  })

  it('stores an untouched optional text answer as an empty string', async () => {
    // The other half of "one entry per question asked, answered or not", the
    // `false` case being the sibling below.
    const server = await build()
    const why = await givenQuestion({ type: 'text', label: 'Why?', required: false })

    await submit(server, { ...applicant, answers: {}, asked: [why] })

    const [row] = await stored()
    expect(row?.answers).toEqual([{ question_id: why, label: 'Why?', type: 'text', value: '' }])
  })

  it('refuses a cleared field naming a question that has since gone', async () => {
    // The boundary the phrase "left blank" hides: `Apply.tsx` writes
    // `answers[id]` on every keystroke, so a field typed into and then emptied
    // sends `''` — a key, which `answerProblems` calls `unknown` for a deleted
    // question. Blank on screen, 400 in the API.
    const server = await build()
    const stays = await givenQuestion({ type: 'text', label: 'Why?', required: false, order: 0 })
    const goes = await givenQuestion({ type: 'text', label: 'Going away', required: false, order: 1 })
    await db().delete(formQuestion).where(eq(formQuestion.id, goes))

    const response = await submit(server, {
      ...applicant,
      answers: { [stays]: 'For the fire', [goes]: '' },
      asked: [stays, goes],
    })

    expect(response.statusCode).toBe(400)
  })

  it('stores an unticked checkbox as false rather than dropping it', async () => {
    // Shown and left alone, which is the distinction the per-question entry
    // exists for: `false` here means "asked, said no", and no entry at all would
    // mean "never asked".
    const server = await build()
    const box = await givenQuestion({ type: 'checkbox', label: 'Bring food', required: false })

    await submit(server, { ...applicant, answers: {}, asked: [box] })

    const [row] = await stored()
    expect(row?.answers).toEqual([{ question_id: box, label: 'Bring food', type: 'checkbox', value: false }])
  })

  it('leaves out a question added while the form was open', async () => {
    // The bug: an optional question added mid-fill passed validation and was
    // stored as `""`, which reads as "asked and declined" to whoever reviews it.
    // The applicant never saw it.
    const server = await build()
    const shown = await givenQuestion({ type: 'text', label: 'Why?', required: false, order: 0 })
    const late = await givenQuestion({ type: 'text', label: 'Added later', required: false, order: 1 })

    await submit(server, { ...applicant, answers: { [shown]: 'For the fire' }, asked: [shown] })

    const [row] = await stored()
    expect(row?.answers).toEqual([{ question_id: shown, label: 'Why?', type: 'text', value: 'For the fire' }])
    expect(JSON.stringify(row?.answers)).not.toContain(late)
  })

  it('drops a question deleted while the form was open and left blank', async () => {
    // The honest case for `asked` naming something the server does not have: there
    // is nothing to store, since the wording comes from the row and the row is
    // gone. Answered, it is a 400 instead — the test below draws that boundary.
    const server = await build()
    const stays = await givenQuestion({ type: 'text', label: 'Why?', required: false, order: 0 })
    const goes = await givenQuestion({ type: 'text', label: 'Going away', required: false, order: 1 })
    await db().delete(formQuestion).where(eq(formQuestion.id, goes))

    const response = await submit(server, {
      ...applicant,
      answers: { [stays]: 'For the fire' },
      asked: [stays, goes],
    })

    expect(response.statusCode).toBe(201)
    const [row] = await stored()
    expect(row?.answers).toEqual([{ question_id: stays, label: 'Why?', type: 'text', value: 'For the fire' }])
  })

  it('refuses when the deleted question had been answered', async () => {
    // The boundary of the case above, and it is not the `asked` filter that
    // decides it: `answerProblems` sees an answer naming no question it holds and
    // says `unknown`, so this is a 400 before the filter is reached. The 201 is
    // for a deleted question left *blank*.
    const server = await build()
    const stays = await givenQuestion({ type: 'text', label: 'Why?', required: false, order: 0 })
    const goes = await givenQuestion({ type: 'text', label: 'Going away', required: false, order: 1 })
    await db().delete(formQuestion).where(eq(formQuestion.id, goes))

    const response = await submit(server, {
      ...applicant,
      answers: { [stays]: 'For the fire', [goes]: 'typed before it vanished' },
      asked: [stays, goes],
    })

    expect(response.statusCode).toBe(400)
    expect(await stored()).toEqual([])
  })

  it('still checks a required question added while the form was open', async () => {
    // The half that must not move. Validation runs against the server's list, or
    // "I wasn't shown that" becomes the way to skip an agreement.
    const server = await build()
    const shown = await givenQuestion({ type: 'text', label: 'Why?', required: false, order: 0 })
    await givenQuestion({ type: 'agreement', label: 'I agree', required: true, order: 1 })

    const response = await submit(server, {
      ...applicant,
      answers: { [shown]: 'For the fire' },
      asked: [shown],
    })

    expect(response.statusCode).toBe(400)
    expect(await stored()).toEqual([])
  })

  it('refuses an answer to a question the form says it never showed', async () => {
    // A body disagreeing with itself. Dropping the answer silently would lose
    // what someone typed; storing it would make `asked` a decoration.
    const server = await build()
    const one = await givenQuestion({ type: 'text', label: 'Why?', required: false, order: 0 })
    const two = await givenQuestion({ type: 'text', label: 'Anything else?', required: false, order: 1 })

    const response = await submit(server, {
      ...applicant,
      answers: { [one]: 'For the fire', [two]: 'smuggled' },
      asked: [one],
    })

    expect(response.statusCode).toBe(400)
    expect(await stored()).toEqual([])
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

describe('telling the admins', () => {
  it('sends the page to open and the category with the wording, like every other push', async () => {
    // It went to the push senders directly and carried a body alone, which was
    // invisible while the worker had `/admin/applications` written into it and the one
    // notification going nowhere the moment it stopped (#279). Now it is a bell row
    // first and a push copied from it (#326), so all three fields come from one place
    // — what the row holds is what the push carries.
    const deliver = vi.fn<Delivery>(() => Promise.resolve('sent'))
    const server = await build(deliver)
    await givenSubscribedAdmin()

    expect((await submit(server, { ...applicant, answers: {} })).statusCode).toBe(201)

    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(1))
    expect(JSON.parse(String(deliver.mock.calls[0]?.[1]))).toEqual({
      body: 'Someone has applied to join.',
      link: '/admin/applications',
      category: 'application',
    })
  })
})

describe('talking to an applicant', () => {
  const sayAsApplicant = (server: FastifyInstance, cookie: string, body: string) =>
    server.inject({
      method: 'POST',
      url: '/api/me/application/messages',
      headers: { cookie },
      payload: { body },
    })

  const sayAsAdmin = (server: FastifyInstance, cookie: string, id: string, body: string) =>
    server.inject({
      method: 'POST',
      url: `/api/admin/applications/${id}/messages`,
      headers: { cookie },
      payload: { body },
    })

  const mine = (server: FastifyInstance, cookie: string) =>
    server.inject({ method: 'GET', url: '/api/me/application', headers: { cookie } })

  const givenAdmin = async () => {
    const id = randomUUID()
    await db()
      .insert(account)
      .values({ id, email: `${id}@example.org`, name: 'Ada', password_hash: null, created_at: NOW })
    await db().insert(accountRole).values({ account_id: id, role: 'admin' })

    const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })
    return { id, cookie: `${SESSION_COOKIE}=${sessions.issue(id)}` }
  }

  const givenSent = async (server: FastifyInstance) => {
    const sent = await submit(server, { ...applicant, answers: {} })

    return sent.json().application.id as string
  }

  it('carries what the organisers said on the applicant’s own page', async () => {
    const server = await build()
    const id = await givenSent(server)
    const ada = await givenAdmin()

    await sayAsAdmin(server, ada.cookie, id, 'Who are you coming with?')

    const said = mine(server, applicantCookie())
    expect((await said).json().mine.messages.map((one: { body: string }) => one.body)).toEqual([
      'Who are you coming with?',
    ])
  })

  it('says whose each message is, so the two sides read apart', async () => {
    const server = await build()
    const id = await givenSent(server)
    const ada = await givenAdmin()
    await sayAsAdmin(server, ada.cookie, id, 'Who are you coming with?')

    const answered = await sayAsApplicant(server, applicantCookie(), 'My neighbour Bea.')

    expect(answered.json().messages.map((one: { mine: boolean; author_name: string }) => one.mine)).toEqual([
      false,
      true,
    ])
    expect(answered.json().messages[0].author_name).toBe('Ada')
  })

  it('is refused to somebody who is not signed in', async () => {
    const server = await build()
    const id = await givenSent(server)

    expect(
      (
        await server.inject({
          method: 'POST',
          url: '/api/me/application/messages',
          payload: { body: 'hello' },
        })
      ).statusCode,
    ).toBe(401)
    expect(
      (await server.inject({ method: 'GET', url: `/api/admin/applications/${id}/messages` })).statusCode,
    ).toBe(401)
  })

  it('is nobody else’s to read, however they ask', async () => {
    // The one conversation that is not member-visible: an applicant sees their own and no other,
    // and the route takes no id for exactly that reason.
    const server = await build()
    await givenSent(server)
    const stranger = await givenApplicant()

    expect((await mine(server, stranger.cookie)).json().mine.messages).toEqual([])
    expect((await sayAsApplicant(server, stranger.cookie, 'hello')).statusCode).toBe(404)
  })

  it('is refused to a member who is not an organiser', async () => {
    const server = await build()
    const id = await givenSent(server)
    const member = await givenApplicant()
    await db().insert(accountRole).values({ account_id: member.id, role: 'member' })

    expect((await sayAsAdmin(server, member.cookie, id, 'hello')).statusCode).toBe(403)
  })

  it('refuses a message that says nothing', async () => {
    const server = await build()
    await givenSent(server)

    expect((await sayAsApplicant(server, applicantCookie(), '   ')).statusCode).toBe(400)
  })

  it('tells the applicant when the organisers write', async () => {
    const server = await build()
    const id = await givenSent(server)
    const ada = await givenAdmin()
    const waiting = applicantAccount?.id ?? ''

    await sayAsAdmin(server, ada.cookie, id, 'Who are you coming with?')

    const told = await db().select().from(notification).where(eq(notification.account_id, waiting))
    expect(told.map((one) => [one.category, one.body])).toEqual([
      ['application_news', 'The organisers replied to your application.'],
    ])
  })

  it('tells the organisers when the applicant does', async () => {
    const server = await build()
    await givenSent(server)
    const ada = await givenAdmin()

    await sayAsApplicant(server, applicantCookie(), 'My neighbour Bea.')

    const told = await db().select().from(notification).where(eq(notification.account_id, ada.id))
    expect(told.map((one) => one.body)).toEqual(['An applicant has replied.'])
  })
})

describe('the name an application carries', () => {
  it('fills in an account that came in with none, which a provider often leaves', async () => {
    // `updateMyProfile` is behind `requireApproved`, so an applicant cannot fill it in while
    // they wait — and without it every card and every push about them says "Somebody".
    const server = await build()

    await submit(server, { ...applicant, answers: {} })

    const [row] = await db()
      .select()
      .from(account)
      .where(eq(account.id, applicantAccount?.id ?? ''))
    expect(row?.name).toBe('Fredrik')
  })

  it('leaves a name somebody already gave alone', async () => {
    const server = await build()
    await db()
      .update(account)
      .set({ name: 'Wren' })
      .where(eq(account.id, applicantAccount?.id ?? ''))

    await submit(server, { ...applicant, answers: {} })

    const [row] = await db()
      .select()
      .from(account)
      .where(eq(account.id, applicantAccount?.id ?? ''))
    expect(row?.name).toBe('Wren')
  })
})

describe('who an applicant is told to ask', () => {
  const mine = (server: FastifyInstance, cookie: string) =>
    server.inject({ method: 'GET', url: '/api/me/application', headers: { cookie } })

  const givenOrganiser = async () => {
    const id = randomUUID()
    await db()
      .insert(account)
      .values({
        id,
        email: `${id}@example.org`,
        name: 'Ada',
        contact: 'ada on discord',
        password_hash: null,
        created_at: NOW,
      })
    await db().insert(accountRole).values({ account_id: id, role: 'admin' })

    return id
  }

  const decided = async (status: 'approved' | 'rejected') => {
    await db()
      .update(application)
      .set({ status, decided_at: NOW })
      .where(eq(application.account_id, applicantAccount?.id ?? ''))
  }

  it('names them where the answer was no, which is what recourse means', async () => {
    const server = await build()
    await givenOrganiser()
    await submit(server, { ...applicant, answers: {} })
    await decided('rejected')

    const said = await mine(server, applicantCookie())

    expect(said.json().mine.organisers.map((one: { name: string; contact: string }) => one.contact)).toEqual([
      'ada on discord',
    ])
  })

  it('names nobody to an account that has not applied at all', async () => {
    // Sign-up is open, so this route is reachable by anybody who can make an account — and the
    // admins' contact details are a members-only read everywhere else.
    const server = await build()
    await givenOrganiser()

    expect((await mine(server, applicantCookie())).json().mine.organisers).toEqual([])
  })

  it('names nobody while an application is still waiting', async () => {
    const server = await build()
    await givenOrganiser()
    await submit(server, { ...applicant, answers: {} })

    expect((await mine(server, applicantCookie())).json().mine.organisers).toEqual([])
  })

  it('names nobody where the answer was yes, since they are in and can read the roster', async () => {
    const server = await build()
    await givenOrganiser()
    await submit(server, { ...applicant, answers: {} })
    await decided('approved')

    expect((await mine(server, applicantCookie())).json().mine.organisers).toEqual([])
  })
})
