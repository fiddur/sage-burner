import type { BuildProject, Thread } from '@sage-burner/shared'
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
import { account, accountRole, attendance, buildHelper, buildItem, event } from '../db/schema.ts'
import { sendGuarded } from '../if-match.testing.ts'
import { bell, cardOf, setOn } from './threads.testing.ts'

const SECRET = 's'.repeat(40)
const NOW = '2026-07-02T00:00:00.000Z'

let handle: DbHandle | undefined
let app: FastifyInstance | undefined
let clock = new Date(NOW)

afterEach(async () => {
  await app?.close()
  handle?.close()
  app = undefined
  handle = undefined
  clock = new Date(NOW)
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
    now: () => clock,
    deliver: () => Promise.resolve('sent'),
    mintKeys: () => ({ publicKey: 'a-public-key', privateKey: 'a-private-key' }),
  })
  return app
}

const tickClock = () => {
  clock = new Date(clock.getTime() + 1000)
}

const givenEvent = async (start = '2026-08-01') => {
  const id = randomUUID()
  await db()
    .insert(event)
    .values({
      id,
      name: 'Summer burn',
      slug: `burn-${id.slice(0, 8)}`,
      start_date: start,
      end_date: start,
      member_cap: 42,
      created_at: NOW,
    })
  return id
}

const givenAccount = async (roles: ('admin' | 'member')[], name = 'Ada') => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, password_hash: null, name, created_at: NOW })
  for (const role of roles) await db().insert(accountRole).values({ account_id: id, role })

  const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })
  return { id, cookie: `${SESSION_COOKIE}=${sessions.issue(id)}` }
}

const givenComing = async (eventId: string, accountId: string) => {
  await db().insert(attendance).values({
    id: randomUUID(),
    event_id: eventId,
    account_id: accountId,
    joined_at: NOW,
    payment_status: 'unpaid',
  })
}

const headersFor = (cookie: string | undefined) => (cookie === undefined ? {} : { cookie })

const list = (server: FastifyInstance, cookie: string | undefined, eventId: string) =>
  server.inject({ method: 'GET', url: `/api/events/${eventId}/build`, headers: headersFor(cookie) })

const projects = async (server: FastifyInstance, cookie: string, eventId: string): Promise<BuildProject[]> =>
  (await list(server, cookie, eventId)).json().projects

const add = async (
  server: FastifyInstance,
  cookie: string | undefined,
  eventId: string,
  payload: Record<string, unknown> = { title: 'Dome', tier: 'reality' },
): Promise<LightMyRequestResponse> => {
  tickClock()

  return await server.inject({
    method: 'POST',
    url: `/api/events/${eventId}/build`,
    headers: headersFor(cookie),
    payload,
  })
}

const added = async (
  server: FastifyInstance,
  cookie: string,
  eventId: string,
  payload?: Record<string, unknown>,
): Promise<BuildProject> => (await add(server, cookie, eventId, payload)).json().project

const edit = (server: FastifyInstance, cookie: string, id: string, payload: Record<string, unknown>) =>
  sendGuarded((extra) =>
    server.inject({ method: 'PATCH', url: `/api/build/${id}`, headers: { cookie, ...extra }, payload }),
  )

const reorderTier = (
  server: FastifyInstance,
  cookie: string,
  eventId: string,
  payload: Record<string, unknown>,
) =>
  sendGuarded((extra) =>
    server.inject({
      method: 'PUT',
      url: `/api/events/${eventId}/build/order`,
      headers: { cookie, ...extra },
      payload,
    }),
  )

const withdraw = (server: FastifyInstance, cookie: string, id: string) =>
  server.inject({ method: 'DELETE', url: `/api/build/${id}`, headers: { cookie } })

const restore = (server: FastifyInstance, cookie: string, id: string) =>
  server.inject({ method: 'POST', url: `/api/build/${id}/restore`, headers: { cookie } })

const setLead = (server: FastifyInstance, cookie: string, id: string, accountId: string | null) =>
  server.inject({
    method: 'PUT',
    url: `/api/build/${id}/lead`,
    headers: { cookie },
    payload: { account_id: accountId },
  })

const addHelper = (server: FastifyInstance, cookie: string, id: string, accountId: string) =>
  server.inject({
    method: 'POST',
    url: `/api/build/${id}/helpers`,
    headers: { cookie },
    payload: { account_id: accountId },
  })

const removeHelper = (server: FastifyInstance, cookie: string, id: string, accountId: string) =>
  server.inject({ method: 'DELETE', url: `/api/build/${id}/helpers/${accountId}`, headers: { cookie } })

const addItem = async (
  server: FastifyInstance,
  cookie: string,
  id: string,
  payload: Record<string, unknown>,
) => {
  tickClock()

  return await server.inject({ method: 'POST', url: `/api/build/${id}/items`, headers: { cookie }, payload })
}

const editItem = (
  server: FastifyInstance,
  cookie: string,
  itemId: string,
  payload: Record<string, unknown>,
) => server.inject({ method: 'PATCH', url: `/api/build-items/${itemId}`, headers: { cookie }, payload })

const removeItem = (server: FastifyInstance, cookie: string, itemId: string) =>
  server.inject({ method: 'DELETE', url: `/api/build-items/${itemId}`, headers: { cookie } })

const feed = async (server: FastifyInstance, cookie: string): Promise<Thread[]> =>
  (await server.inject({ method: 'GET', url: '/api/feed', headers: { cookie } })).json().threads

const entriesOn = async (server: FastifyInstance, cookie: string, threadId: string) =>
  (await cardOf(server, cookie, threadId)).entries.map((entry) => [
    entry.author?.name ?? null,
    entry.kind,
    entry.body,
  ])

const say = (server: FastifyInstance, cookie: string, threadId: string, body: string) =>
  server.inject({
    method: 'POST',
    url: `/api/threads/${threadId}/comments`,
    headers: { cookie },
    payload: { body },
  })

const heart = (server: FastifyInstance, cookie: string, threadId: string) =>
  server.inject({ method: 'POST', url: `/api/threads/${threadId}/support/me`, headers: { cookie } })

const threadOf = (project: BuildProject): string => {
  if (project.thread_id === null) throw new Error(`no thread for ${project.id}`)

  return project.thread_id
}

const titlesIn = (all: readonly BuildProject[], tier: string) =>
  all
    .filter((project) => project.tier === tier && project.withdrawn_at === null)
    .map((project) => project.title)

describe('who may plan the build', () => {
  it('lets any approved member add, edit and take a project off, admin-only accounts included', async () => {
    const server = await build()
    const eventId = await givenEvent()

    for (const roles of [['member'], ['admin'], ['member', 'admin']] as const) {
      const { cookie } = await givenAccount([...roles])
      const response = await add(server, cookie, eventId, { title: `By ${roles.join('+')}`, tier: 'reality' })

      expect(response.statusCode, roles.join('+')).toBe(201)
      const { id } = response.json().project
      expect((await list(server, cookie, eventId)).statusCode).toBe(200)
      expect((await edit(server, cookie, id, { title: 'Renamed' })).statusCode).toBe(200)
      expect((await withdraw(server, cookie, id)).statusCode).toBe(204)
    }
  })

  it('refuses a stranger and an account with no roles, for reads as well as writes', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const applicant = await givenAccount([])

    expect((await list(server, undefined, eventId)).statusCode).toBe(401)
    expect((await add(server, undefined, eventId)).statusCode).toBe(401)
    expect((await list(server, applicant.cookie, eventId)).statusCode).toBe(403)
    expect((await add(server, applicant.cookie, eventId)).statusCode).toBe(403)
  })
})

describe('a project', () => {
  it('goes to the end of its header, and the next one after it', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])

    const dome = await added(server, ada.cookie, eventId, { title: 'Dome', tier: 'reality' })
    const swing = await added(server, ada.cookie, eventId, { title: 'Swing', tier: 'nice_to_have' })
    const kitchen = await added(server, ada.cookie, eventId, { title: 'Kitchen', tier: 'reality' })

    expect([dome.order, kitchen.order, swing.order]).toEqual([0, 1, 0])
    const all = await projects(server, ada.cookie, eventId)
    expect(titlesIn(all, 'reality')).toEqual(['Dome', 'Kitchen'])
    expect(titlesIn(all, 'nice_to_have')).toEqual(['Swing'])
  })

  it('starts with no lead, no helpers, an empty checklist and an empty description', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])

    const dome = await added(server, ada.cookie, eventId)

    expect(dome).toMatchObject({
      title: 'Dome',
      description: '',
      author_account_id: ada.id,
      author_name: 'Ada',
      lead: null,
      helpers: [],
      items: [],
      withdrawn_at: null,
      support_count: 0,
      supported_by_me: false,
    })
  })

  it('refuses a tier outside the two headers, a blank title and an unrecognised key', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])

    expect((await add(server, ada.cookie, eventId, { title: 'Dome', tier: 'someday' })).statusCode).toBe(400)
    expect((await add(server, ada.cookie, eventId, { title: '  ', tier: 'reality' })).statusCode).toBe(400)
    expect(
      (await add(server, ada.cookie, eventId, { title: 'Dome', tier: 'reality', x: 1 })).statusCode,
    ).toBe(400)
    expect((await add(server, ada.cookie, eventId, { title: 'Dome', tier: 'reality' })).statusCode).toBe(201)
  })

  it('answers 404 for a burn that does not exist', async () => {
    const server = await build()
    const ada = await givenAccount(['member'])

    expect((await add(server, ada.cookie, randomUUID())).statusCode).toBe(404)
  })

  it('opens a card with who added it, carrying the description as its body', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])
    await givenComing(eventId, ada.id)

    const dome = await added(server, ada.cookie, eventId, {
      title: 'Dome',
      tier: 'reality',
      description: 'Geodesic, 6 m',
    })

    const [card] = await feed(server, ada.cookie)
    expect(card).toMatchObject({
      id: dome.thread_id,
      entity_type: 'build',
      title: 'Dome',
      body: 'Geodesic, 6 m',
      link: `/build?burn=${eventId}&project=${dome.id}`,
      own: true,
    })
    expect(await entriesOn(server, ada.cookie, threadOf(dome))).toEqual([
      ['Ada', 'added', 'added this build project'],
    ])
  })

  it('tells the attendees who asked about new projects, and neither the one who added it nor anyone not coming', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])
    const bea = await givenAccount(['member'], 'Bea')
    const cai = await givenAccount(['member'], 'Cai')
    await givenComing(eventId, ada.id)
    await givenComing(eventId, bea.id)
    for (const who of [ada, bea, cai]) await setOn(server, who.cookie, ['build_added'])

    const dome = await added(server, ada.cookie, eventId)

    expect(await bell(server, bea.cookie)).toEqual([
      expect.objectContaining({
        category: 'build_added',
        body: 'A new build project: Dome',
        link: `/build?burn=${eventId}&project=${dome.id}`,
      }),
    ])
    expect(await bell(server, ada.cookie)).toEqual([])
    expect(await bell(server, cai.cookie)).toEqual([])
  })
})

describe('editing a project', () => {
  it('refuses an edit written against no version, and one against an old version, answering with what is saved now', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])
    const bea = await givenAccount(['member'], 'Bea')
    const mine = await added(server, ada.cookie, eventId)
    const theirs = await added(server, bea.cookie, eventId, { title: 'Swing', tier: 'reality' })
    const asAdaSawIt = String((await list(server, ada.cookie, eventId)).headers.etag)

    const bare = await server.inject({
      method: 'PATCH',
      url: `/api/build/${mine.id}`,
      headers: { cookie: ada.cookie },
      payload: { title: 'Big dome' },
    })
    expect(bare.statusCode).toBe(428)

    expect((await edit(server, bea.cookie, theirs.id, { description: 'Rope and a plank' })).statusCode).toBe(
      200,
    )

    const stale = await server.inject({
      method: 'PATCH',
      url: `/api/build/${mine.id}`,
      headers: { cookie: ada.cookie, 'if-match': asAdaSawIt },
      payload: { title: 'Big dome' },
    })
    expect(stale.statusCode).toBe(412)
    expect(stale.json().projects[theirs.id].description).toBe('Rope and a plank')
  })

  it('takes one written against the version it was handed', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])
    const mine = await added(server, ada.cookie, eventId)
    const current = String((await list(server, ada.cookie, eventId)).headers.etag)

    const response = await server.inject({
      method: 'PATCH',
      url: `/api/build/${mine.id}`,
      headers: { cookie: ada.cookie, 'if-match': current },
      payload: { title: 'Big dome' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().project.title).toBe('Big dome')
  })

  it('does not count a tick, a checklist line, a lead or a helper as a change somebody could clobber', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])
    await givenComing(eventId, ada.id)
    const dome = await added(server, ada.cookie, eventId)
    const before = String((await list(server, ada.cookie, eventId)).headers.etag)

    const item = (await addItem(server, ada.cookie, dome.id, { text: 'Struts' })).json().project.items[0]
    await editItem(server, ada.cookie, item.id, { done: true })
    await setLead(server, ada.cookie, dome.id, ada.id)
    await addHelper(server, ada.cookie, dome.id, ada.id)

    expect(String((await list(server, ada.cookie, eventId)).headers.etag)).toBe(before)
    const response = await server.inject({
      method: 'PATCH',
      url: `/api/build/${dome.id}`,
      headers: { cookie: ada.cookie, 'if-match': before },
      payload: { description: 'Geodesic' },
    })
    expect(response.statusCode).toBe(200)
  })

  it('treats an empty edit as a read, writing nothing on the card', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])
    const dome = await added(server, ada.cookie, eventId)

    const response = await server.inject({
      method: 'PATCH',
      url: `/api/build/${dome.id}`,
      headers: { cookie: ada.cookie },
      payload: {},
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().project.title).toBe('Dome')
    expect(await entriesOn(server, ada.cookie, threadOf(dome))).toHaveLength(1)
  })

  it('says it was edited once, however many times in a row, and renames the card', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])
    const dome = await added(server, ada.cookie, eventId)

    await edit(server, ada.cookie, dome.id, { title: 'Big dome' })
    await edit(server, ada.cookie, dome.id, { description: 'Geodesic' })

    expect(await entriesOn(server, ada.cookie, threadOf(dome))).toEqual([
      ['Ada', 'added', 'added this build project'],
      ['Ada', 'edited', 'edited this project'],
    ])
    expect((await cardOf(server, ada.cookie, threadOf(dome))).title).toBe('Big dome')
  })

  it('moves a project to the end of the other header, and says where it went', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])
    await added(server, ada.cookie, eventId, { title: 'Swing', tier: 'nice_to_have' })
    const dome = await added(server, ada.cookie, eventId, { title: 'Dome', tier: 'reality' })
    await added(server, ada.cookie, eventId, { title: 'Kitchen', tier: 'reality' })

    const moved = (await edit(server, ada.cookie, dome.id, { tier: 'nice_to_have' })).json().project

    expect(moved.order).toBe(1)
    const all = await projects(server, ada.cookie, eventId)
    expect(titlesIn(all, 'nice_to_have')).toEqual(['Swing', 'Dome'])
    expect(titlesIn(all, 'reality')).toEqual(['Kitchen'])
    expect((await entriesOn(server, ada.cookie, threadOf(dome))).at(-1)).toEqual([
      'Ada',
      'edited',
      'moved it to Nice to have',
    ])
  })
})

describe('arranging a header', () => {
  it('puts the projects of one header in the order given', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])
    const dome = await added(server, ada.cookie, eventId, { title: 'Dome', tier: 'reality' })
    const kitchen = await added(server, ada.cookie, eventId, { title: 'Kitchen', tier: 'reality' })
    await added(server, ada.cookie, eventId, { title: 'Swing', tier: 'nice_to_have' })

    const response = await reorderTier(server, ada.cookie, eventId, {
      tier: 'reality',
      ids: [kitchen.id, dome.id],
    })

    expect(response.statusCode).toBe(200)
    expect(titlesIn(response.json().projects, 'reality')).toEqual(['Kitchen', 'Dome'])
    expect(titlesIn(await projects(server, ada.cookie, eventId), 'nice_to_have')).toEqual(['Swing'])
  })

  it('refuses a set that is not exactly that header’s projects', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])
    const dome = await added(server, ada.cookie, eventId, { title: 'Dome', tier: 'reality' })
    const kitchen = await added(server, ada.cookie, eventId, { title: 'Kitchen', tier: 'reality' })
    const swing = await added(server, ada.cookie, eventId, { title: 'Swing', tier: 'nice_to_have' })

    expect(
      (await reorderTier(server, ada.cookie, eventId, { tier: 'reality', ids: [dome.id] })).statusCode,
    ).toBe(400)
    expect(
      (
        await reorderTier(server, ada.cookie, eventId, {
          tier: 'reality',
          ids: [dome.id, kitchen.id, swing.id],
        })
      ).statusCode,
    ).toBe(400)
    expect(
      (await reorderTier(server, ada.cookie, eventId, { tier: 'nice_to_have', ids: [dome.id] })).statusCode,
    ).toBe(400)
  })

  it('leaves a project that was taken off out of the set', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])
    const dome = await added(server, ada.cookie, eventId, { title: 'Dome', tier: 'reality' })
    const kitchen = await added(server, ada.cookie, eventId, { title: 'Kitchen', tier: 'reality' })
    await withdraw(server, ada.cookie, dome.id)

    expect(
      (await reorderTier(server, ada.cookie, eventId, { tier: 'reality', ids: [kitchen.id] })).statusCode,
    ).toBe(200)
  })
})

describe('leading a project', () => {
  it('refuses somebody who is not coming to that burn', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])
    const bea = await givenAccount(['member'], 'Bea')
    await givenComing(eventId, ada.id)
    const dome = await added(server, ada.cookie, eventId)

    const response = await setLead(server, ada.cookie, dome.id, bea.id)

    expect(response.statusCode).toBe(400)
    expect(response.json().error).toBe('not_attending')
    expect((await setLead(server, ada.cookie, dome.id, ada.id)).json().project.lead).toEqual({
      account_id: ada.id,
      name: 'Ada',
    })
  })

  it('tells the person handed it and the person it came off, and never the one who clicked', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const org = await givenAccount(['member'], 'Org')
    const bea = await givenAccount(['member'], 'Bea')
    const cai = await givenAccount(['member'], 'Cai')
    for (const who of [org, bea, cai]) await givenComing(eventId, who.id)
    const dome = await added(server, org.cookie, eventId)

    await setLead(server, org.cookie, dome.id, org.id)
    await setLead(server, org.cookie, dome.id, bea.id)
    await setLead(server, org.cookie, dome.id, cai.id)

    expect(await bell(server, org.cookie)).toEqual([])
    expect((await bell(server, bea.cookie)).map((one) => [one.category, one.body, one.link])).toEqual([
      ['build_role', 'You are no longer leading Dome.', `/build?burn=${eventId}&project=${dome.id}`],
      ['build_role', 'You are now leading Dome.', `/build?burn=${eventId}&project=${dome.id}`],
    ])
    expect((await bell(server, cai.cookie)).map((one) => one.body)).toEqual(['You are now leading Dome.'])
  })

  it('says on the card which way the leading went', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])
    const bea = await givenAccount(['member'], 'Bea')
    await givenComing(eventId, ada.id)
    await givenComing(eventId, bea.id)
    const dome = await added(server, ada.cookie, eventId)

    await setLead(server, ada.cookie, dome.id, ada.id)
    await setLead(server, ada.cookie, dome.id, bea.id)
    await setLead(server, ada.cookie, dome.id, bea.id)
    await setLead(server, bea.cookie, dome.id, null)

    expect((await entriesOn(server, ada.cookie, threadOf(dome))).slice(1)).toEqual([
      ['Ada', 'facilitator', 'is leading it'],
      ['Ada', 'facilitator', 'asked Bea to lead it'],
      ['Bea', 'facilitator', 'stepped back from leading it'],
    ])
  })
})

describe('helping with a project', () => {
  it('takes people on and off, telling them and saying so on the card', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])
    const bea = await givenAccount(['member'], 'Bea')
    await givenComing(eventId, ada.id)
    await givenComing(eventId, bea.id)
    const dome = await added(server, ada.cookie, eventId)

    const joined = await addHelper(server, ada.cookie, dome.id, bea.id)
    await addHelper(server, ada.cookie, dome.id, bea.id)
    expect(joined.json().project.helpers).toEqual([{ account_id: bea.id, name: 'Bea' }])
    expect((await removeHelper(server, ada.cookie, dome.id, bea.id)).statusCode).toBe(204)

    expect((await bell(server, bea.cookie)).map((one) => [one.category, one.body])).toEqual([
      ['build_role', 'You have been taken off helping with Dome.'],
      ['build_role', 'You have been added to helping with Dome.'],
    ])
    expect((await entriesOn(server, ada.cookie, threadOf(dome))).slice(1)).toEqual([
      ['Ada', 'helper', 'asked Bea to help'],
      ['Ada', 'helper', 'took Bea off helping'],
    ])
  })

  it('tells nobody about their own hand, and says it in their own words', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])
    await givenComing(eventId, ada.id)
    const dome = await added(server, ada.cookie, eventId)

    await addHelper(server, ada.cookie, dome.id, ada.id)
    await removeHelper(server, ada.cookie, dome.id, ada.id)

    expect(await bell(server, ada.cookie)).toEqual([])
    expect((await entriesOn(server, ada.cookie, threadOf(dome))).slice(1)).toEqual([
      ['Ada', 'helper', 'is helping'],
      ['Ada', 'helper', 'stopped helping'],
    ])
  })

  it('refuses somebody who is not coming to that burn', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])
    const bea = await givenAccount(['member'], 'Bea')
    const dome = await added(server, ada.cookie, eventId)

    const response = await addHelper(server, ada.cookie, dome.id, bea.id)

    expect(response.statusCode).toBe(400)
    expect(response.json().error).toBe('not_attending')
  })
})

describe('the checklist', () => {
  it('asks for a thing as needed unless told otherwise', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])
    const dome = await added(server, ada.cookie, eventId)

    const response = await addItem(server, ada.cookie, dome.id, { text: 'Struts' })

    expect(response.statusCode).toBe(201)
    expect(response.json().project.items).toEqual([
      expect.objectContaining({ text: 'Struts', priority: 'needed', done: null }),
    ])
  })

  it('lists needed, then good, then bonus, each in the order written, and a tick moves nothing', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])
    const dome = await added(server, ada.cookie, eventId)
    await addItem(server, ada.cookie, dome.id, { text: 'Fairy lights', priority: 'bonus' })
    await addItem(server, ada.cookie, dome.id, { text: 'Tarp', priority: 'good' })
    await addItem(server, ada.cookie, dome.id, { text: 'Struts', priority: 'needed' })
    const last = await addItem(server, ada.cookie, dome.id, { text: 'Bolts', priority: 'needed' })
    const struts = (last.json().project as BuildProject).items.find((item) => item.text === 'Struts')
    if (struts === undefined) throw new Error('no struts')

    const ticked = await editItem(server, ada.cookie, struts.id, { done: true })

    expect(
      (ticked.json().project as BuildProject).items.map((item) => [item.text, item.done !== null]),
    ).toEqual([
      ['Struts', true],
      ['Bolts', false],
      ['Tarp', false],
      ['Fairy lights', false],
    ])
  })

  it('records who ticked a thing and when, keeps that on a second tick, and forgets it on an untick', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])
    const bea = await givenAccount(['member'], 'Bea')
    const dome = await added(server, ada.cookie, eventId)
    const [item] = (await addItem(server, ada.cookie, dome.id, { text: 'Struts' })).json().project.items

    const tickedAt = clock.toISOString()
    const ticked = (await editItem(server, ada.cookie, item.id, { done: true })).json().project.items[0]
    tickClock()
    const again = (await editItem(server, bea.cookie, item.id, { done: true })).json().project.items[0]
    const unticked = (await editItem(server, bea.cookie, item.id, { done: false })).json().project.items[0]

    expect(ticked.done).toEqual({ account_id: ada.id, name: 'Ada', at: tickedAt })
    expect(again.done).toEqual(ticked.done)
    expect(unticked.done).toBeNull()
  })

  it('rewords and reprioritises a thing, and deletes it outright', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])
    const dome = await added(server, ada.cookie, eventId)
    const [item] = (await addItem(server, ada.cookie, dome.id, { text: 'Struts' })).json().project.items

    const changed = (
      await editItem(server, ada.cookie, item.id, { text: 'Steel struts', priority: 'good' })
    ).json().project.items[0]
    expect(changed).toMatchObject({ text: 'Steel struts', priority: 'good' })

    expect((await removeItem(server, ada.cookie, item.id)).statusCode).toBe(204)
    expect(await db().select().from(buildItem).where(eq(buildItem.id, item.id))).toEqual([])
  })

  it('writes nothing on the card and tells nobody, whatever happens to it', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])
    const bea = await givenAccount(['member'], 'Bea')
    await givenComing(eventId, ada.id)
    await givenComing(eventId, bea.id)
    await setOn(server, bea.cookie, ['build_added', 'build_role', 'build_comment', 'build_comment_any'])
    const dome = await added(server, ada.cookie, eventId)
    const before = await bell(server, bea.cookie)

    const [item] = (await addItem(server, ada.cookie, dome.id, { text: 'Struts' })).json().project.items
    await editItem(server, ada.cookie, item.id, { text: 'Steel struts', done: true })
    await editItem(server, ada.cookie, item.id, { done: false })
    await removeItem(server, ada.cookie, item.id)

    expect(await entriesOn(server, ada.cookie, threadOf(dome))).toHaveLength(1)
    expect(await bell(server, bea.cookie)).toEqual(before)
  })
})

describe('a burn that has ended', () => {
  const setUp = async () => {
    const server = await build()
    const over = await givenEvent('2026-06-01')
    const ada = await givenAccount(['member'])
    await givenComing(over, ada.id)
    const open = await givenEvent()
    await givenComing(open, ada.id)
    clock = new Date('2026-05-01T00:00:00.000Z')
    const dome = await added(server, ada.cookie, over)
    const [item] = (await addItem(server, ada.cookie, dome.id, { text: 'Struts' })).json().project.items
    clock = new Date(NOW)

    return { server, over, open, ada, dome, itemId: String(item.id) }
  }

  it('refuses every write, keyed by the project or by the burn', async () => {
    const { server, over, ada, dome, itemId } = await setUp()

    expect((await add(server, ada.cookie, over)).statusCode).toBe(404)
    expect(
      (await reorderTier(server, ada.cookie, over, { tier: 'reality', ids: [dome.id] })).statusCode,
    ).toBe(404)
    expect((await edit(server, ada.cookie, dome.id, { title: 'Renamed' })).statusCode).toBe(404)
    expect((await setLead(server, ada.cookie, dome.id, ada.id)).statusCode).toBe(404)
    expect((await addHelper(server, ada.cookie, dome.id, ada.id)).statusCode).toBe(404)
    expect((await removeHelper(server, ada.cookie, dome.id, ada.id)).statusCode).toBe(404)
    expect((await addItem(server, ada.cookie, dome.id, { text: 'Bolts' })).statusCode).toBe(404)
    expect((await editItem(server, ada.cookie, itemId, { done: true })).statusCode).toBe(404)
    expect((await removeItem(server, ada.cookie, itemId)).statusCode).toBe(404)
    expect((await withdraw(server, ada.cookie, dome.id)).statusCode).toBe(404)
    expect((await restore(server, ada.cookie, dome.id)).statusCode).toBe(404)
  })

  it('takes every one of them on a burn that has not ended', async () => {
    const { server, open, ada } = await setUp()
    const dome = await added(server, ada.cookie, open)
    const [item] = (await addItem(server, ada.cookie, dome.id, { text: 'Struts' })).json().project.items

    expect(
      (await reorderTier(server, ada.cookie, open, { tier: 'reality', ids: [dome.id] })).statusCode,
    ).toBe(200)
    expect((await edit(server, ada.cookie, dome.id, { title: 'Renamed' })).statusCode).toBe(200)
    expect((await setLead(server, ada.cookie, dome.id, ada.id)).statusCode).toBe(200)
    expect((await addHelper(server, ada.cookie, dome.id, ada.id)).statusCode).toBe(200)
    expect((await removeHelper(server, ada.cookie, dome.id, ada.id)).statusCode).toBe(204)
    expect((await addItem(server, ada.cookie, dome.id, { text: 'Bolts' })).statusCode).toBe(201)
    expect((await editItem(server, ada.cookie, item.id, { done: true })).statusCode).toBe(200)
    expect((await removeItem(server, ada.cookie, item.id)).statusCode).toBe(204)
    expect((await withdraw(server, ada.cookie, dome.id)).statusCode).toBe(204)
    expect((await restore(server, ada.cookie, dome.id)).statusCode).toBe(200)
  })
})

describe('taking a project off', () => {
  it('keeps it, and all it held, where the page can offer it back, and marks its card gone', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])
    await givenComing(eventId, ada.id)
    const dome = await added(server, ada.cookie, eventId)
    await addItem(server, ada.cookie, dome.id, { text: 'Struts' })
    await addHelper(server, ada.cookie, dome.id, ada.id)

    expect((await withdraw(server, ada.cookie, dome.id)).statusCode).toBe(204)
    expect((await withdraw(server, ada.cookie, dome.id)).statusCode).toBe(204)

    const [kept] = await projects(server, ada.cookie, eventId)
    expect(kept?.withdrawn_at).toBe(clock.toISOString())
    expect(kept?.items.map((item) => item.text)).toEqual(['Struts'])
    expect(kept?.helpers.map((helper) => helper.name)).toEqual(['Ada'])
    expect(await feed(server, ada.cookie)).toEqual([])
    expect((await cardOf(server, ada.cookie, threadOf(dome))).gone).toBe(true)
    expect(
      (await entriesOn(server, ada.cookie, threadOf(dome))).filter(([, kind]) => kind === 'withdrawn'),
    ).toEqual([['Ada', 'withdrawn', 'took this project off']])
  })

  it('refuses every other write to it', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])
    await givenComing(eventId, ada.id)
    const dome = await added(server, ada.cookie, eventId)
    const [item] = (await addItem(server, ada.cookie, dome.id, { text: 'Struts' })).json().project.items
    await withdraw(server, ada.cookie, dome.id)

    expect((await edit(server, ada.cookie, dome.id, { title: 'Renamed' })).statusCode).toBe(404)
    expect((await setLead(server, ada.cookie, dome.id, ada.id)).statusCode).toBe(404)
    expect((await addHelper(server, ada.cookie, dome.id, ada.id)).statusCode).toBe(404)
    expect((await addItem(server, ada.cookie, dome.id, { text: 'Bolts' })).statusCode).toBe(404)
    expect((await editItem(server, ada.cookie, item.id, { done: true })).statusCode).toBe(404)
    expect((await removeItem(server, ada.cookie, item.id)).statusCode).toBe(404)
  })

  it('brings it back at the end of its header with everything it had, saying who did', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])
    const bea = await givenAccount(['member'], 'Bea')
    await givenComing(eventId, ada.id)
    const dome = await added(server, ada.cookie, eventId, { title: 'Dome', tier: 'reality' })
    await added(server, ada.cookie, eventId, { title: 'Kitchen', tier: 'reality' })
    await addItem(server, ada.cookie, dome.id, { text: 'Struts' })
    await addHelper(server, ada.cookie, dome.id, ada.id)
    await heart(server, bea.cookie, threadOf(dome))
    await withdraw(server, ada.cookie, dome.id)

    const back = await restore(server, bea.cookie, dome.id)

    expect(back.statusCode).toBe(200)
    expect(back.json().project).toMatchObject({
      withdrawn_at: null,
      order: 2,
      items: [expect.objectContaining({ text: 'Struts' })],
      helpers: [{ account_id: ada.id, name: 'Ada' }],
      support_count: 1,
    })
    expect(titlesIn(await projects(server, ada.cookie, eventId), 'reality')).toEqual(['Kitchen', 'Dome'])
    expect((await entriesOn(server, ada.cookie, threadOf(dome))).at(-1)).toEqual([
      'Bea',
      'restored',
      'brought this project back',
    ])
    expect((await feed(server, ada.cookie)).map((card) => card.entity_id)).toContain(dome.id)
  })
})

describe('the card a project carries', () => {
  it('shows a heart on the page as it does on the card, and tells whoever added it', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])
    const bea = await givenAccount(['member'], 'Bea')
    await givenComing(eventId, ada.id)
    await givenComing(eventId, bea.id)
    const dome = await added(server, ada.cookie, eventId)

    await heart(server, bea.cookie, threadOf(dome))

    const [asBea] = await projects(server, bea.cookie, eventId)
    const [asAda] = await projects(server, ada.cookie, eventId)
    expect(asBea).toMatchObject({ support_count: 1, supported_by_me: true })
    expect(asAda).toMatchObject({ support_count: 1, supported_by_me: false })
    expect(asAda?.supporters.map((one) => one.name)).toEqual(['Bea'])
    expect((await bell(server, ada.cookie)).map((one) => [one.category, one.body])).toEqual([
      ['hearted', 'Bea hearts Dome'],
    ])
  })

  it('tells whoever added it, leads it and helps with it when somebody says something, and not the one who said it', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])
    const bea = await givenAccount(['member'], 'Bea')
    const cai = await givenAccount(['member'], 'Cai')
    const dan = await givenAccount(['member'], 'Dan')
    for (const who of [ada, bea, cai, dan]) await givenComing(eventId, who.id)
    const dome = await added(server, ada.cookie, eventId)
    await setLead(server, ada.cookie, dome.id, bea.id)
    await addHelper(server, ada.cookie, dome.id, cai.id)

    expect((await say(server, dan.cookie, threadOf(dome), 'where do the struts go?')).statusCode).toBe(200)

    for (const listener of [ada, bea, cai]) {
      expect(await bell(server, listener.cookie)).toContainEqual(
        expect.objectContaining({
          category: 'build_comment',
          body: 'Dan said something about Dome',
          link: `/build?burn=${eventId}&project=${dome.id}`,
        }),
      )
    }
    expect(await bell(server, dan.cookie)).toEqual([])
  })

  it('reaches whoever asked about any project, on its own switch', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])
    const bea = await givenAccount(['member'], 'Bea')
    await givenComing(eventId, ada.id)
    await givenComing(eventId, bea.id)
    await setOn(server, bea.cookie, ['build_comment_any'])
    const dome = await added(server, ada.cookie, eventId)

    await say(server, ada.cookie, threadOf(dome), 'struts arrive Friday')

    expect((await bell(server, bea.cookie)).map((one) => one.category)).toEqual(['build_comment_any'])
  })

  it('is followed by whoever leads it or helps with it', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])
    const bea = await givenAccount(['member'], 'Bea')
    const cai = await givenAccount(['member'], 'Cai')
    const dan = await givenAccount(['member'], 'Dan')
    for (const who of [ada, bea, cai, dan]) await givenComing(eventId, who.id)
    const dome = await added(server, ada.cookie, eventId)
    await setLead(server, ada.cookie, dome.id, bea.id)
    await addHelper(server, ada.cookie, dome.id, cai.id)

    for (const who of [ada, bea, cai]) {
      expect((await cardOf(server, who.cookie, threadOf(dome))).followed_by_me).toBe(true)
    }
    expect((await cardOf(server, dan.cookie, threadOf(dome))).followed_by_me).toBe(false)
  })
})

describe('the database, for writes that skip the API', () => {
  it('drops helpers and checklist lines with the project', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])
    await givenComing(eventId, ada.id)
    const dome = await added(server, ada.cookie, eventId)
    await addItem(server, ada.cookie, dome.id, { text: 'Struts' })
    await addHelper(server, ada.cookie, dome.id, ada.id)

    handle?.client.prepare('delete from build_project where id = ?').run(dome.id)

    expect(await db().select().from(buildItem)).toEqual([])
    expect(await db().select().from(buildHelper)).toEqual([])
  })
})
