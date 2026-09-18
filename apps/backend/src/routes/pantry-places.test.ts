import type { PantryItem, PantryPlace, PantryPlacesResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { SESSION_COOKIE } from '../auth/viewer.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, accountRole } from '../db/schema.ts'

const SECRET = 'p'.repeat(40)
const NOW = '2026-09-18T10:00:00.000Z'

const KITCHEN = 'fa0d0001-0000-4000-8000-000000000001'
const HALLWAY = 'fa0d0001-0000-4000-8000-000000000002'
const CELLAR = 'fa0d0001-0000-4000-8000-000000000003'

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

const givenAccount = async (name: string, roles: ('admin' | 'member')[] = ['member']) => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, name, password_hash: null, created_at: NOW })
  for (const role of roles) await db().insert(accountRole).values({ account_id: id, role })

  const sessions = createSessions({ secret: SECRET, now: () => new Date(NOW), ttlSeconds: 3600 })

  return { id, name, cookie: `${SESSION_COOKIE}=${sessions.issue(id)}` }
}

const places = async (server: FastifyInstance, cookie: string): Promise<PantryPlacesResponse> =>
  (await server.inject({ method: 'GET', url: '/api/pantry-places', headers: { cookie } })).json()

const addPlace = (server: FastifyInstance, cookie: string, payload: Record<string, unknown>) =>
  server.inject({ method: 'POST', url: '/api/admin/pantry-places', headers: { cookie }, payload })

const renamePlace = (server: FastifyInstance, cookie: string, id: string, payload: Record<string, unknown>) =>
  server.inject({ method: 'PATCH', url: `/api/admin/pantry-places/${id}`, headers: { cookie }, payload })

const removePlace = (server: FastifyInstance, cookie: string, id: string) =>
  server.inject({ method: 'DELETE', url: `/api/admin/pantry-places/${id}`, headers: { cookie } })

const reorderPlaces = (server: FastifyInstance, cookie: string, ids: string[]) =>
  server.inject({
    method: 'PUT',
    url: '/api/admin/pantry-places/order',
    headers: { cookie },
    payload: { ids },
  })

const putSpot = (server: FastifyInstance, cookie: string, id: string, placeId: string, spot: string) =>
  server.inject({
    method: 'PUT',
    url: `/api/pantry/${id}/places/${placeId}`,
    headers: { cookie },
    payload: { spot },
  })

const removeSpot = (server: FastifyInstance, cookie: string, id: string, placeId: string) =>
  server.inject({ method: 'DELETE', url: `/api/pantry/${id}/places/${placeId}`, headers: { cookie } })

const given = async (
  server: FastifyInstance,
  cookie: string,
  name: string,
  over: Record<string, unknown> = {},
): Promise<PantryItem> => {
  const made = await server.inject({
    method: 'POST',
    url: '/api/admin/pantry',
    headers: { cookie },
    payload: { kind: 'staple', name, ...over },
  })

  return made.json().item
}

const oneItem = async (server: FastifyInstance, cookie: string, id: string): Promise<PantryItem> => {
  const { items }: { items: PantryItem[] } = (
    await server.inject({ method: 'GET', url: '/api/pantry', headers: { cookie } })
  ).json()
  const found = items.find((item) => item.id === id)
  if (found === undefined) throw new Error('no such thing')

  return found
}

describe('the rooms a thing can be in', () => {
  it('comes seeded with the house’s four, in the order the spreadsheet had them', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')

    expect((await places(server, ada.cookie)).places.map((one) => one.name)).toEqual([
      'Kitchen',
      'Hallway',
      'Cellar',
      'Party kitchen',
    ])
  })

  it('seeds no “Somewhere” where no row said where it lived', async () => {
    const server = await build()
    const ada = await givenAccount('Ada')

    expect((await places(server, ada.cookie)).places.map((one) => one.name)).not.toContain('Somewhere')
  })

  it('is no business of somebody signed out, or of an account with no role yet', async () => {
    const server = await build()
    const newcomer = await givenAccount('Nils', [])

    expect((await server.inject({ method: 'GET', url: '/api/pantry-places' })).statusCode).toBe(401)
    expect(
      (
        await server.inject({
          method: 'GET',
          url: '/api/pantry-places',
          headers: { cookie: newcomer.cookie },
        })
      ).statusCode,
    ).toBe(403)
  })

  it('takes a new room from an admin, at the end of the list', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin'])

    const made = await addPlace(server, ada.cookie, { name: 'Shed' })

    expect(made.statusCode).toBe(201)
    const place: PantryPlace = made.json().place
    expect(place.order).toBe(4)
    expect((await places(server, ada.cookie)).places.at(-1)?.name).toBe('Shed')
  })

  it('refuses a member the add, the rename, the bin and the reordering', async () => {
    const server = await build()
    const bo = await givenAccount('Bo')

    expect((await addPlace(server, bo.cookie, { name: 'Shed' })).statusCode).toBe(403)
    expect((await renamePlace(server, bo.cookie, KITCHEN, { name: 'Kök' })).statusCode).toBe(403)
    expect((await removePlace(server, bo.cookie, KITCHEN)).statusCode).toBe(403)
    expect((await reorderPlaces(server, bo.cookie, [KITCHEN])).statusCode).toBe(403)
  })

  it('will not have two rooms of the same name, whatever the capitals', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin'])

    const again = await addPlace(server, ada.cookie, { name: ' cellar ' })

    expect(again.statusCode).toBe(409)
  })

  it('refuses a rename onto a name already taken, and lets a room keep its own', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin'])

    expect((await renamePlace(server, ada.cookie, KITCHEN, { name: 'CELLAR' })).statusCode).toBe(409)
    expect((await renamePlace(server, ada.cookie, KITCHEN, { name: 'Kitchen' })).statusCode).toBe(200)
  })

  it('renames one, which is what the refused delete tells people to do', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin'])

    const written = await renamePlace(server, ada.cookie, KITCHEN, { name: 'Köket' })

    expect(written.statusCode).toBe(200)
    expect((await places(server, ada.cookie)).places[0]?.name).toBe('Köket')
  })

  it('removes an empty room, and answers 404 for one that is not there', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin'])

    expect((await removePlace(server, ada.cookie, KITCHEN)).statusCode).toBe(204)
    expect((await places(server, ada.cookie)).places.map((one) => one.id)).not.toContain(KITCHEN)
    expect((await removePlace(server, ada.cookie, randomUUID())).statusCode).toBe(404)
  })

  it('refuses to remove a room something is still in, so it is renamed instead', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin'])
    const rice = await given(server, ada.cookie, 'Rice')
    await putSpot(server, ada.cookie, rice.id, CELLAR, 'R2')

    const refused = await removePlace(server, ada.cookie, CELLAR)

    expect(refused.statusCode).toBe(409)
    expect((await places(server, ada.cookie)).places.map((one) => one.id)).toContain(CELLAR)
  })

  it('refuses it for a thing taken off the list too, since the spot is still recorded', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin'])
    const rice = await given(server, ada.cookie, 'Rice')
    await putSpot(server, ada.cookie, rice.id, CELLAR, 'R2')
    await server.inject({
      method: 'DELETE',
      url: `/api/admin/pantry/${rice.id}`,
      headers: { cookie: ada.cookie },
    })

    expect((await removePlace(server, ada.cookie, CELLAR)).statusCode).toBe(409)
  })

  it('puts the rooms in the order an admin drags them into', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin'])
    const was = (await places(server, ada.cookie)).places.map((one) => one.id)
    const wanted = [...was].reverse()

    const written = await reorderPlaces(server, ada.cookie, wanted)

    expect(written.statusCode).toBe(200)
    expect((await places(server, ada.cookie)).places.map((one) => one.id)).toEqual(wanted)
  })

  it('refuses an order that is not the same set of rooms', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin'])

    expect((await reorderPlaces(server, ada.cookie, [KITCHEN])).statusCode).toBe(400)
  })
})

describe('what the room table itself refuses, which no route has to be trusted for', () => {
  const put =
    (itemId: string, placeId: string, spot = '') =>
    () =>
      client()
        .prepare('INSERT INTO pantry_item_place (item_id, place_id, spot) VALUES (?, ?, ?)')
        .run(itemId, placeId, spot)

  const drop = (placeId: string) => () =>
    client().prepare('DELETE FROM pantry_place WHERE id = ?').run(placeId)

  it('takes a thing in a room, and refuses the same room twice', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin'])
    const rice = await given(server, ada.cookie, 'Rice')

    expect(put(rice.id, CELLAR, 'R2')).not.toThrow()
    expect(put(rice.id, CELLAR, 'R3')).toThrow()
  })

  it('refuses a spot in a room nobody named, or for a thing that is not there', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin'])
    const rice = await given(server, ada.cookie, 'Rice')

    expect(put(rice.id, randomUUID())).toThrow()
    expect(put(randomUUID(), CELLAR)).toThrow()
  })

  it('refuses to drop a room that still holds something, which is the 409 above', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin'])
    const rice = await given(server, ada.cookie, 'Rice')

    put(rice.id, CELLAR, 'R2')()

    expect(drop(CELLAR)).toThrow()
    expect(drop(HALLWAY)).not.toThrow()
  })

  it('takes a thing’s spots with it when the pantry row is deleted outright', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin'])
    const rice = await given(server, ada.cookie, 'Rice')
    put(rice.id, CELLAR, 'R2')()

    client().prepare('DELETE FROM pantry_item WHERE id = ?').run(rice.id)

    expect(client().prepare('SELECT * FROM pantry_item_place WHERE item_id = ?').all(rice.id)).toHaveLength(0)
  })

  it('refuses a room with no name', async () => {
    await build()

    expect(() =>
      client()
        .prepare('INSERT INTO pantry_place (id, "order", name) VALUES (?, ?, ?)')
        .run(randomUUID(), 5, '  '),
    ).toThrow()
  })

  it('refuses a second room of the same name, whatever the capitals', async () => {
    await build()

    expect(() =>
      client()
        .prepare('INSERT INTO pantry_place (id, "order", name) VALUES (?, ?, ?)')
        .run(randomUUID(), 5, ' cellar '),
    ).toThrow()
  })
})

describe('putting a thing in a room, which any member may do', () => {
  it('writes the spot and reads back in the vocabulary’s order', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin'])
    const bo = await givenAccount('Bo')
    const rice = await given(server, ada.cookie, 'Rice')

    await putSpot(server, bo.cookie, rice.id, CELLAR, 'R2')
    const written = await putSpot(server, bo.cookie, rice.id, HALLWAY, 'bucket')

    expect(written.statusCode).toBe(200)
    expect(written.json().item.places).toEqual([
      { place_id: HALLWAY, name: 'Hallway', spot: 'bucket' },
      { place_id: CELLAR, name: 'Cellar', spot: 'R2' },
    ])
  })

  it('takes a room with no box named, since a thing can be in a room at no particular box', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin'])
    const rice = await given(server, ada.cookie, 'Rice')

    const written = await putSpot(server, ada.cookie, rice.id, KITCHEN, '')

    expect(written.statusCode).toBe(200)
    expect(written.json().item.places).toEqual([{ place_id: KITCHEN, name: 'Kitchen', spot: '' }])
  })

  it('writes over the box a thing was in rather than adding a second', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin'])
    const rice = await given(server, ada.cookie, 'Rice')

    await putSpot(server, ada.cookie, rice.id, CELLAR, 'R2')
    const written = await putSpot(server, ada.cookie, rice.id, CELLAR, 'R10')

    expect(written.json().item.places).toEqual([{ place_id: CELLAR, name: 'Cellar', spot: 'R10' }])
  })

  it('takes a thing out of one room and leaves the others, and says 204 either way', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin'])
    const bo = await givenAccount('Bo')
    const rice = await given(server, ada.cookie, 'Rice')
    await putSpot(server, ada.cookie, rice.id, CELLAR, 'R2')
    await putSpot(server, ada.cookie, rice.id, HALLWAY, 'bucket')

    expect((await removeSpot(server, bo.cookie, rice.id, CELLAR)).statusCode).toBe(204)
    expect((await removeSpot(server, bo.cookie, rice.id, CELLAR)).statusCode).toBe(204)
    expect((await oneItem(server, bo.cookie, rice.id)).places).toEqual([
      { place_id: HALLWAY, name: 'Hallway', spot: 'bucket' },
    ])
  })

  it('leaves the thing on the list when it is taken out of a room', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin'])
    const rice = await given(server, ada.cookie, 'Rice')
    await putSpot(server, ada.cookie, rice.id, CELLAR, 'R2')

    await removeSpot(server, ada.cookie, rice.id, CELLAR)

    expect((await oneItem(server, ada.cookie, rice.id)).withdrawn_at).toBeNull()
  })

  it('is a 404 for a room nobody named, and for a thing that is not there', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin'])
    const rice = await given(server, ada.cookie, 'Rice')

    expect((await putSpot(server, ada.cookie, rice.id, randomUUID(), 'R2')).statusCode).toBe(404)
    expect((await putSpot(server, ada.cookie, randomUUID(), CELLAR, 'R2')).statusCode).toBe(404)
  })

  it('is a 404 for a thing taken off the list, as counting one is', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin'])
    const rice = await given(server, ada.cookie, 'Rice')
    await server.inject({
      method: 'DELETE',
      url: `/api/admin/pantry/${rice.id}`,
      headers: { cookie: ada.cookie },
    })

    expect((await putSpot(server, ada.cookie, rice.id, CELLAR, 'R2')).statusCode).toBe(404)
  })

  it('is no business of somebody signed out, or of an account with no role yet', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin'])
    const newcomer = await givenAccount('Nils', [])
    const rice = await given(server, ada.cookie, 'Rice')

    expect(
      (
        await server.inject({
          method: 'PUT',
          url: `/api/pantry/${rice.id}/places/${CELLAR}`,
          payload: { spot: 'R2' },
        })
      ).statusCode,
    ).toBe(401)
    expect((await putSpot(server, newcomer.cookie, rice.id, CELLAR, 'R2')).statusCode).toBe(403)
    expect((await removeSpot(server, newcomer.cookie, rice.id, CELLAR)).statusCode).toBe(403)
  })
})

describe('placing a thing as the admin adds or edits it', () => {
  it('takes the rooms on the add', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin'])

    const rice = await given(server, ada.cookie, 'Rice', {
      places: [{ place_id: CELLAR, spot: 'R2' }, { place_id: KITCHEN }],
    })

    expect(rice.places).toEqual([
      { place_id: KITCHEN, name: 'Kitchen', spot: '' },
      { place_id: CELLAR, name: 'Cellar', spot: 'R2' },
    ])
  })

  it('replaces what was there on the edit, so unplacing is a save', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin'])
    const rice = await given(server, ada.cookie, 'Rice', { places: [{ place_id: CELLAR, spot: 'R2' }] })

    const written = await server.inject({
      method: 'PATCH',
      url: `/api/admin/pantry/${rice.id}`,
      headers: { cookie: ada.cookie },
      payload: { places: [{ place_id: HALLWAY, spot: 'bucket' }] },
    })

    expect(written.statusCode).toBe(200)
    expect(written.json().item.places).toEqual([{ place_id: HALLWAY, name: 'Hallway', spot: 'bucket' }])
  })

  it('leaves the rooms alone where the edit says nothing about them', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin'])
    const rice = await given(server, ada.cookie, 'Rice', { places: [{ place_id: CELLAR, spot: 'R2' }] })

    const written = await server.inject({
      method: 'PATCH',
      url: `/api/admin/pantry/${rice.id}`,
      headers: { cookie: ada.cookie },
      payload: { unit: 'kg' },
    })

    expect(written.json().item.places).toEqual([{ place_id: CELLAR, name: 'Cellar', spot: 'R2' }])
  })

  it('refuses a room nobody named rather than dropping it quietly', async () => {
    const server = await build()
    const ada = await givenAccount('Ada', ['admin'])

    const made = await server.inject({
      method: 'POST',
      url: '/api/admin/pantry',
      headers: { cookie: ada.cookie },
      payload: { kind: 'staple', name: 'Rice', places: [{ place_id: randomUUID(), spot: 'R2' }] },
    })

    expect(made.statusCode).toBe(400)
  })
})
