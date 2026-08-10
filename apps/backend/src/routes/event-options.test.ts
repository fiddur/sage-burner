import type { FastifyInstance } from 'fastify'

import { eventOptionResponseSchema } from '@sage-burner/shared'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { SESSION_COOKIE } from '../auth/viewer.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole, attendance, event, eventOption } from '../db/schema.ts'
import { sendGuarded } from '../if-match.testing.ts'

const SECRET = 's'.repeat(40)
const NOW = '2026-07-02T00:00:00.000Z'

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
    now: () => new Date(NOW),
  })
  return app
}

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

const givenAccount = async (roles: ('admin' | 'member')[]) => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, password_hash: null, created_at: NOW })
  for (const role of roles) await db().insert(accountRole).values({ account_id: id, role })

  const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })
  return { id, cookie: `${SESSION_COOKIE}=${sessions.issue(id)}` }
}

const givenEvent = async () => {
  const id = randomUUID()
  await db()
    .insert(event)
    .values({
      id,
      name: 'Summer burn',
      slug: `burn-${id.slice(0, 8)}`,
      start_date: '2026-08-01',
      end_date: '2026-08-05',
      member_cap: 42,
      created_at: NOW,
    })
  return id
}

const list = (server: FastifyInstance, eventId: string) =>
  server.inject({ method: 'GET', url: `/api/events/${eventId}/options` })

const add = (
  server: FastifyInstance,
  cookie: string | undefined,
  eventId: string,
  payload: Record<string, unknown>,
) =>
  server.inject({
    method: 'POST',
    url: `/api/events/${eventId}/options`,
    headers: cookie === undefined ? {} : { cookie },
    payload,
  })

const edit = (
  server: FastifyInstance,
  cookie: string | undefined,
  id: string,
  payload: Record<string, unknown>,
) =>
  sendGuarded((extra) =>
    server.inject({
      method: 'PATCH',
      url: `/api/event-options/${id}`,
      headers: { ...(cookie === undefined ? {} : { cookie }), ...extra },
      payload,
    }),
  )

const remove = (server: FastifyInstance, cookie: string | undefined, id: string) =>
  server.inject({
    method: 'DELETE',
    url: `/api/event-options/${id}`,
    headers: cookie === undefined ? {} : { cookie },
  })

const reorder = (
  server: FastifyInstance,
  cookie: string | undefined,
  eventId: string,
  kind: string,
  payload: Record<string, unknown>,
) =>
  sendGuarded((extra) =>
    server.inject({
      method: 'PUT',
      url: `/api/events/${eventId}/options/${kind}/order`,
      headers: { ...(cookie === undefined ? {} : { cookie }), ...extra },
      payload,
    }),
  )

const labels = (server: FastifyInstance, eventId: string, kind: string) =>
  list(server, eventId).then((response) =>
    response
      .json()
      .options.filter((row: { kind: string }) => row.kind === kind)
      .map((row: { label: string }) => row.label),
  )

describe('the lists a member picks from', () => {
  it('is empty before an admin sets any up', async () => {
    const server = await build()
    const eventId = await givenEvent()

    const response = await list(server, eventId)

    expect(response.statusCode).toBe(200)
    expect(response.json().options).toEqual([])
  })

  it('adds somewhere to sleep, with how many fit', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])

    const response = await add(server, admin.cookie, eventId, {
      kind: 'lodging',
      label: 'Temple mattress',
      capacity: 9,
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().option).toMatchObject({
      kind: 'lodging',
      label: 'Temple mattress',
      capacity: 9,
      order: 0,
    })
    expect(eventOptionResponseSchema.safeParse(response.json()).success).toBe(true)
  })

  it('leaves the capacity unset when there is no limit', async () => {
    // "Own tent" fits as many as turn up, and so does every helping-out entry.
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])

    const response = await add(server, admin.cookie, eventId, { kind: 'lodging', label: 'Own tent' })

    expect(response.statusCode).toBe(201)
    expect(response.json().option.capacity).toBeNull()
  })

  it('numbers the two lists independently', async () => {
    // They are shown as separate lists, so the first helping entry is the first
    // of its own list rather than the third of a shared one.
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])

    await add(server, admin.cookie, eventId, { kind: 'lodging', label: 'Temple mattress' })
    await add(server, admin.cookie, eventId, { kind: 'lodging', label: 'Own tent' })
    const helping = await add(server, admin.cookie, eventId, { kind: 'helping', label: 'Sauna tending' })

    expect(helping.json().option.order).toBe(0)
    expect(await labels(server, eventId, 'lodging')).toEqual(['Temple mattress', 'Own tent'])
  })

  it('counts how many have taken each one, so a member can be told it is full', async () => {
    // The only way to say "full" without a member-visible list of who is sleeping
    // where. A count, not a roster.
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])
    const temple = (
      await add(server, admin.cookie, eventId, { kind: 'lodging', label: 'Temple', capacity: 9 })
    ).json().option.id
    const tent = (await add(server, admin.cookie, eventId, { kind: 'lodging', label: 'Own tent' })).json()
      .option.id

    for (const _ of [1, 2]) {
      const who = await givenAccount(['member'])
      await db().insert(attendance).values({
        id: randomUUID(),
        event_id: eventId,
        account_id: who.id,
        joined_at: NOW,
        payment_status: 'unpaid',
        lodging_option_id: temple,
      })
    }

    const counted = (await list(server, eventId)).json().options as { id: string; taken: number }[]

    expect(counted.find((row) => row.id === temple)?.taken).toBe(2)
    expect(counted.find((row) => row.id === tent)?.taken).toBe(0)
  })

  it('keeps one burn out of another', async () => {
    const server = await build()
    const mine = await givenEvent()
    const other = await givenEvent()
    const admin = await givenAccount(['admin'])

    await add(server, admin.cookie, mine, { kind: 'lodging', label: 'Ours' })
    await add(server, admin.cookie, other, { kind: 'lodging', label: 'Theirs' })

    expect(await labels(server, mine, 'lodging')).toEqual(['Ours'])
  })

  it('answers 404 for a burn that does not exist', async () => {
    const server = await build()
    const admin = await givenAccount(['admin'])

    expect(
      (await add(server, admin.cookie, randomUUID(), { kind: 'lodging', label: 'Nowhere' })).statusCode,
    ).toBe(404)
  })

  it('refuses a kind it does not know, a blank label and a nonsense capacity', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])

    for (const body of [
      { kind: 'catering', label: 'x' },
      { kind: 'lodging', label: '   ' },
      { kind: 'lodging', label: 'x', capacity: 0 },
      { kind: 'lodging', label: 'x', capacity: -1 },
      { kind: 'lodging', label: 'x', capacity: 1.5 },
      { kind: 'lodging', label: 'x', order: 3 },
    ]) {
      expect((await add(server, admin.cookie, eventId, body)).statusCode, JSON.stringify(body)).toBe(400)
    }
  })

  it('renames one and changes how many fit', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])
    const id = (
      await add(server, admin.cookie, eventId, { kind: 'lodging', label: 'Temple', capacity: 9 })
    ).json().option.id

    const response = await edit(server, admin.cookie, id, { label: 'Temple mattress', capacity: 12 })

    expect(response.statusCode).toBe(200)
    expect(response.json().option).toMatchObject({ label: 'Temple mattress', capacity: 12 })
  })

  it('clears a capacity back to no limit', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])
    const id = (
      await add(server, admin.cookie, eventId, { kind: 'lodging', label: 'Temple', capacity: 9 })
    ).json().option.id

    expect((await edit(server, admin.cookie, id, { capacity: null })).json().option.capacity).toBeNull()
  })

  it('refuses to move an entry between the two lists', async () => {
    // Moving one is deleting and adding: the orders are per kind, so a `kind`
    // change would leave it numbered against the list it came from.
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])
    const id = (await add(server, admin.cookie, eventId, { kind: 'lodging', label: 'Temple' })).json().option
      .id

    expect((await edit(server, admin.cookie, id, { kind: 'helping' })).statusCode).toBe(400)
  })

  it('treats an empty edit as a read rather than a 500', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])
    const id = (await add(server, admin.cookie, eventId, { kind: 'lodging', label: 'Temple' })).json().option
      .id

    const response = await edit(server, admin.cookie, id, {})

    expect(response.statusCode).toBe(200)
    expect(response.json().option.label).toBe('Temple')
  })

  it('answers 404 when editing or deleting something that is not there', async () => {
    const server = await build()
    await givenEvent()
    const admin = await givenAccount(['admin'])

    expect((await edit(server, admin.cookie, randomUUID(), { label: 'x' })).statusCode).toBe(404)
    expect((await edit(server, admin.cookie, randomUUID(), {})).statusCode).toBe(404)
    expect((await remove(server, admin.cookie, randomUUID())).statusCode).toBe(404)
  })

  it('removes one', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])
    const id = (await add(server, admin.cookie, eventId, { kind: 'lodging', label: 'Temple' })).json().option
      .id

    expect((await remove(server, admin.cookie, id)).statusCode).toBe(204)
    expect(await labels(server, eventId, 'lodging')).toEqual([])
  })

  it('cannot be removed while somebody is sleeping in it', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])
    const who = await givenAccount(['member'])
    const id = (
      await add(server, admin.cookie, eventId, { kind: 'lodging', label: 'Temple', capacity: 9 })
    ).json().option.id
    await db().insert(attendance).values({
      id: randomUUID(),
      event_id: eventId,
      account_id: who.id,
      joined_at: NOW,
      payment_status: 'unpaid',
      lodging_option_id: id,
    })

    const response = await remove(server, admin.cookie, id)

    expect(response.statusCode).toBe(409)
    expect(await labels(server, eventId, 'lodging')).toEqual(['Temple'])
  })

  it('goes with the burn when the burn goes', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])
    await add(server, admin.cookie, eventId, { kind: 'lodging', label: 'Temple' })

    client().prepare('delete from event where id = ?').run(eventId)

    expect(await db().select().from(eventOption)).toEqual([])
  })

  it('reorders one list without touching the other', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])
    const temple = (await add(server, admin.cookie, eventId, { kind: 'lodging', label: 'Temple' })).json()
      .option.id
    const tent = (await add(server, admin.cookie, eventId, { kind: 'lodging', label: 'Own tent' })).json()
      .option.id
    await add(server, admin.cookie, eventId, { kind: 'helping', label: 'Sauna' })
    await add(server, admin.cookie, eventId, { kind: 'helping', label: 'Kitchen' })

    const response = await reorder(server, admin.cookie, eventId, 'lodging', { ids: [tent, temple] })

    expect(response.statusCode).toBe(200)
    expect(await labels(server, eventId, 'lodging')).toEqual(['Own tent', 'Temple'])
    expect(await labels(server, eventId, 'helping')).toEqual(['Sauna', 'Kitchen'])
  })

  it('refuses an ordering that does not name that list exactly once', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])
    const temple = (await add(server, admin.cookie, eventId, { kind: 'lodging', label: 'Temple' })).json()
      .option.id
    const tent = (await add(server, admin.cookie, eventId, { kind: 'lodging', label: 'Own tent' })).json()
      .option.id
    const sauna = (await add(server, admin.cookie, eventId, { kind: 'helping', label: 'Sauna' })).json()
      .option.id

    expect((await reorder(server, admin.cookie, eventId, 'lodging', { ids: [temple] })).statusCode).toBe(400)
    expect(
      (await reorder(server, admin.cookie, eventId, 'lodging', { ids: [temple, tent, sauna] })).statusCode,
    ).toBe(400)
    expect(await labels(server, eventId, 'lodging')).toEqual(['Temple', 'Own tent'])
  })

  it('answers 404 for a kind that is not one of the two', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])

    expect((await reorder(server, admin.cookie, eventId, 'catering', { ids: [] })).statusCode).toBe(404)
  })

  it('lets any approved member write these lists, admin or not', async () => {
    // These replace a spreadsheet everyone could edit, so a member curates the
    // lodging and helping lists. The admin case is not redundant: `admin` does not
    // imply `member`, so somebody organising but not attending holds one and not the
    // other.
    const server = await build()
    const eventId = await givenEvent()

    for (const roles of [['member'], ['admin'], ['member', 'admin']] as const) {
      const { cookie } = await givenAccount([...roles])
      const added = await add(server, cookie, eventId, { kind: 'lodging', label: `By ${roles.join('+')}` })

      expect(added.statusCode, roles.join('+')).toBe(201)
      const id = added.json().option.id
      expect((await edit(server, cookie, id, { label: `Edited by ${roles.join('+')}` })).statusCode).toBe(200)
      expect((await reorder(server, cookie, eventId, 'lodging', { ids: [id] })).statusCode).toBe(200)
      expect((await remove(server, cookie, id)).statusCode).toBe(204)
    }
  })

  it('refuses every write to a stranger, and to an account with no roles', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const admin = await givenAccount(['admin'])
    const roleless = await givenAccount([])
    const id = (await add(server, admin.cookie, eventId, { kind: 'lodging', label: 'Temple' })).json().option
      .id

    for (const [cookie, expected] of [
      [undefined, 401],
      [roleless.cookie, 403],
    ] as const) {
      expect((await add(server, cookie, eventId, { kind: 'lodging', label: 'Theirs' })).statusCode).toBe(
        expected,
      )
      expect((await edit(server, cookie, id, { label: 'Theirs' })).statusCode).toBe(expected)
      expect((await remove(server, cookie, id)).statusCode).toBe(expected)
      expect((await reorder(server, cookie, eventId, 'lodging', { ids: [id] })).statusCode).toBe(expected)
    }

    expect(await labels(server, eventId, 'lodging')).toEqual(['Temple'])
  })

  it('keeps a nonsense row out of the database, whatever the caller is', async () => {
    // The CHECKs earn their place against writes the Zod schema never sees.
    const server = await build()
    const eventId = await givenEvent()
    await server.inject({ method: 'GET', url: `/api/events/${eventId}/options` })

    const row = (kind: string, label: string, capacity: number | null) => () =>
      client()
        .prepare(
          'insert into event_option (id, event_id, kind, "order", label, capacity) values (?,?,?,?,?,?)',
        )
        .run(randomUUID(), eventId, kind, 0, label, capacity)

    expect(row('catering', 'x', null)).toThrow()
    expect(row('lodging', '  ', null)).toThrow()
    expect(row('lodging', 'x', 0)).toThrow()
    expect(row('lodging', 'Temple', 9)).not.toThrow()
  })
})

describe('renaming an option somebody else has just renamed', () => {
  const rename = (server: FastifyInstance, cookie: string, id: string, version?: string) =>
    server.inject({
      method: 'PATCH',
      url: `/api/event-options/${id}`,
      headers: { cookie, ...(version === undefined ? {} : { 'if-match': version }) },
      payload: { label: 'Bell tent' },
    })

  it('refuses one written against no version of the lists, and against an old one', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])
    const mine = (await add(server, ada.cookie, eventId, { kind: 'lodging', label: 'Tent' })).json().option.id

    const asAdaSawIt = String((await list(server, eventId)).headers.etag)

    expect((await rename(server, ada.cookie, mine)).statusCode).toBe(428)

    // The other list moves the same tag: one representation covers both kinds, which
    // is what `GET /options` answers with.
    expect(
      (await add(server, ada.cookie, eventId, { kind: 'helping', label: 'Washing up' })).statusCode,
    ).toBe(201)

    const refused = await rename(server, ada.cookie, mine, asAdaSawIt)
    expect(refused.statusCode).toBe(412)
    expect(refused.json().options.map((option: { label: string }) => option.label)).toContain('Washing up')
  })

  it('takes one written against the version it was handed', async () => {
    const server = await build()
    const eventId = await givenEvent()
    const ada = await givenAccount(['member'])
    const mine = (await add(server, ada.cookie, eventId, { kind: 'lodging', label: 'Tent' })).json().option.id

    const current = String((await list(server, eventId)).headers.etag)

    expect((await rename(server, ada.cookie, mine, current)).statusCode).toBe(200)
  })
})
