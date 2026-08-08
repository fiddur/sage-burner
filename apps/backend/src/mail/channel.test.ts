import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DbHandle } from '../db/index.ts'
import type { Told } from '../push/notify.ts'
import type { Posted } from './mail.ts'

import { createDb, runMigrations } from '../db/index.ts'
import { account, INSTALLATION_ID, mailSetting } from '../db/schema.ts'
import { emailChannel } from './channel.ts'

/**
 * The email half of a notification, and the one promise the caller depends on: it
 * **never throws**.
 *
 * `recordAndPush` starts this before writing the bell row and awaits it after, so a
 * rejection here is one nobody is holding for as long as the write takes — and Node's
 * default for that is to exit the process. What goes in a message is
 * `messages.test.ts`; this is about what happens when something underneath gives way.
 */

const NOW = '2026-08-03T00:00:00.000Z'
const TOLD: Told = { category: 'meal_role', body: 'You are on helper for Dinner', link: '/meals' }

let handle: DbHandle | undefined

afterEach(() => {
  handle?.close()
  handle = undefined
})

const db = () => {
  const found = handle?.db
  if (found === undefined) throw new Error('build() first')

  return found
}

const build = () => {
  handle = createDb({ url: ':memory:' })
  runMigrations(handle)

  return handle.db
}

const givenMailServer = async () => {
  await db().insert(mailSetting).values({
    id: INSTALLATION_ID,
    host: 'smtp.example.org',
    port: 587,
    secure: false,
    username: '',
    password: '',
    from_email: 'burn@example.org',
    from_name: 'The Burning Sage',
    updated_at: NOW,
  })
}

const givenAccount = async () => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, password_hash: null, created_at: NOW })

  return id
}

describe('posting a notification by email', () => {
  it('sends one, and says nothing to the log about it', async () => {
    const database = build()
    await givenMailServer()
    const accountId = await givenAccount()
    const send = vi.fn(() => Promise.resolve())
    const log = vi.fn<(posted: Posted, accountId: string) => void>()

    await emailChannel({ db: database, send, log })(accountId, TOLD)

    expect(send).toHaveBeenCalledTimes(1)
    expect(log).not.toHaveBeenCalled()
  })

  it('reports a refused send rather than throwing it', async () => {
    const database = build()
    await givenMailServer()
    const accountId = await givenAccount()
    const log = vi.fn<(posted: Posted, accountId: string) => void>()

    const posted = await emailChannel({
      db: database,
      send: () => Promise.reject(new Error('550 nope')),
      log,
    })(accountId, TOLD)

    expect(posted).toEqual({ sent: false, reason: '550 nope' })
    expect(log).toHaveBeenCalledWith({ sent: false, reason: '550 nope' }, accountId)
  })

  it('reports a database that has gone away rather than throwing it', async () => {
    // The path `post` does not cover: the reads here are its own, and a rejection
    // from one used to leave the caller's `.catch` to swallow it with nothing said
    // (#357). On the bell path the insert reports the same failure a moment later;
    // where the bell is off there is no insert behind it at all.
    const database = build()
    await givenMailServer()
    const accountId = await givenAccount()
    const log = vi.fn<(posted: Posted, accountId: string) => void>()
    vi.spyOn(database, 'select').mockImplementation(() => {
      throw new Error('the database went away')
    })

    const posted = await emailChannel({ db: database, send: () => Promise.resolve(), log })(accountId, TOLD)

    expect(posted).toEqual({ sent: false, reason: 'the database went away' })
    expect(log).toHaveBeenCalledWith({ sent: false, reason: 'the database went away' }, accountId)
  })

  it('sends nothing at all where no mail server has been set up', async () => {
    // The ordinary state, and the reason that check is first: the two reads after it
    // would be building a message nothing can post.
    const database = build()
    const accountId = await givenAccount()
    const send = vi.fn(() => Promise.resolve())

    await emailChannel({ db: database, send, log: () => undefined })(accountId, TOLD)

    expect(send).not.toHaveBeenCalled()
  })
})
