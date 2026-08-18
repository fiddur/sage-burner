import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DbHandle } from '../db/index.ts'
import type { Told } from '../push/notify.ts'
import type { Posted } from './mail.ts'

import { createDb, runMigrations } from '../db/index.ts'
import { account, INSTALLATION_ID, mailSetting } from '../db/schema.ts'
import { emailChannel } from './channel.ts'

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

const givenAccount = async (name: string | null = null) => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, name, password_hash: null, created_at: NOW })

  return id
}

const LETTER: Told = {
  ...TOLD,
  letter: ({ installation, name }) => ({
    to: 'somewhere@else.example',
    subject: `${installation} wrote to ${name ?? 'nobody'}`,
    text: 'the whole of what was said',
    html: '<p>the whole of what was said</p>',
  }),
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
    const database = build()
    const accountId = await givenAccount()
    const send = vi.fn(() => Promise.resolve())

    await emailChannel({ db: database, send, log: () => undefined })(accountId, TOLD)

    expect(send).not.toHaveBeenCalled()
  })
})

describe('a notification that carries its own letter', () => {
  const sender = () => {
    const posted: { to: string; subject: string }[] = []

    return {
      posted,
      send: (_transport: unknown, message: { to: string; subject: string }) => {
        posted.push(message)

        return Promise.resolve()
      },
    }
  }

  it('posts the letter instead of the one-line copy', async () => {
    const database = build()
    await givenMailServer()
    const accountId = await givenAccount('Ada')
    const { posted, send } = sender()

    await emailChannel({ db: database, send, log: () => undefined })(accountId, LETTER)

    expect(posted[0]?.subject).toBe('Sage Burner wrote to Ada')
  })

  it('lets the letter choose its own address, the account’s being only what it is offered', async () => {
    const database = build()
    await givenMailServer()
    const accountId = await givenAccount('Ada')
    const { posted, send } = sender()

    await emailChannel({ db: database, send, log: () => undefined })(accountId, LETTER)

    expect(posted[0]?.to).toBe('somewhere@else.example')
  })

  it('still posts the one-line copy where a notification carries none', async () => {
    const database = build()
    await givenMailServer()
    const accountId = await givenAccount('Ada')
    const { posted, send } = sender()

    await emailChannel({ db: database, send, log: () => undefined })(accountId, TOLD)

    expect(posted[0]?.subject).toBe('Sage Burner: You are on helper for Dinner')
  })

  it('posts no letter where no mail server has been set up, the gate being the same one', async () => {
    const database = build()
    const accountId = await givenAccount('Ada')
    const { posted, send } = sender()

    await emailChannel({ db: database, send, log: () => undefined })(accountId, LETTER)

    expect(posted).toEqual([])
  })
})
