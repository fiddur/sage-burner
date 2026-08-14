import type { DigestChoice, NotificationCategory } from '@sage-burner/shared'

import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DbHandle } from '../db/index.ts'
import type { Message, Posted, Send } from './mail.ts'

import { createDb, runMigrations } from '../db/index.ts'
import { account, installation, INSTALLATION_ID, mailSetting, notification } from '../db/schema.ts'
import { dueForDigest, isNightHour, MOST_PER_SECTION, sweepDigests, unseenFor } from './digest.ts'

const NOW = new Date('2026-08-14T03:00:00.000Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

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
  await db()
    .insert(mailSetting)
    .values({
      id: INSTALLATION_ID,
      host: 'smtp.example.org',
      port: 587,
      secure: false,
      username: '',
      password: '',
      from_email: 'burn@example.org',
      from_name: 'The Burning Sage',
      updated_at: ago(DAY),
    })
  await db()
    .update(installation)
    .set({ title: 'The Burning Sage' })
    .where(eq(installation.id, INSTALLATION_ID))
}

const givenAccount = async ({
  digest,
  lastActive,
  digestSent,
}: {
  digest?: DigestChoice
  lastActive?: string | null
  digestSent?: string | null
} = {}) => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({
      id,
      email: `${id}@example.org`,
      password_hash: null,
      created_at: ago(30 * DAY),
      ...(digest === undefined ? {} : { digest }),
      last_active_at: lastActive ?? null,
      digest_sent_at: digestSent ?? null,
    })

  return id
}

const givenUnseen = async (
  accountId: string,
  {
    category = 'dream_comment',
    body = 'Ada commented on Sauna at dawn',
    link = '/dreams',
    at = ago(2 * HOUR),
  }: { category?: NotificationCategory; body?: string; link?: string; at?: string } = {},
) => {
  await db().insert(notification).values({
    id: randomUUID(),
    account_id: accountId,
    category,
    body,
    link,
    created_at: at,
  })
}

describe('who is due a digest', () => {
  it('takes somebody who has stayed away and never had one', async () => {
    build()
    const accountId = await givenAccount({ lastActive: ago(3 * DAY) })

    expect((await dueForDigest(db(), NOW)).map((one) => one.account_id)).toEqual([accountId])
  })

  it('takes somebody who has never been here at all', async () => {
    build()
    const accountId = await givenAccount({ lastActive: null })

    expect((await dueForDigest(db(), NOW)).map((one) => one.account_id)).toEqual([accountId])
  })

  it('leaves somebody who was here inside the window', async () => {
    build()
    await givenAccount({ lastActive: ago(2 * HOUR) })

    expect(await dueForDigest(db(), NOW)).toEqual([])
  })

  it('leaves somebody who has switched it off', async () => {
    build()
    await givenAccount({ digest: 'off', lastActive: ago(3 * DAY) })

    expect(await dueForDigest(db(), NOW)).toEqual([])
  })

  it('holds a weekly one to a week, where a daily one would already be due', async () => {
    build()
    await givenAccount({ digest: 'weekly', lastActive: ago(2 * DAY) })

    expect(await dueForDigest(db(), NOW)).toEqual([])
  })

  it('takes the weekly one once the week is up', async () => {
    build()
    const accountId = await givenAccount({ digest: 'weekly', lastActive: ago(8 * DAY) })

    expect((await dueForDigest(db(), NOW)).map((one) => one.account_id)).toEqual([accountId])
  })

  it('leaves somebody who has had one inside the window, however long they have been away', async () => {
    build()
    await givenAccount({ lastActive: ago(30 * DAY), digestSent: ago(3 * HOUR) })

    expect(await dueForDigest(db(), NOW)).toEqual([])
  })

  it('says nothing about digests when nobody has said anything', async () => {
    build()
    const accountId = await givenAccount({ lastActive: ago(3 * DAY) })

    expect(await dueForDigest(db(), NOW)).toEqual([
      { account_id: accountId, email: expect.any(String), choice: 'daily', since: null },
    ])
  })
})

describe('what a digest holds', () => {
  it('groups what is unseen by category, and makes each link absolute', async () => {
    build()
    const accountId = await givenAccount()
    await givenUnseen(accountId, { category: 'dream_comment', body: 'Ada commented', link: '/dreams' })
    await givenUnseen(accountId, { category: 'point_raised', body: 'Bo raised Firewood', link: '/meetings' })

    const sections = await unseenFor(
      db(),
      accountId,
      { since: null, window: DAY, origin: 'https://burn.example' },
      NOW,
    )

    expect(sections.map((section) => section.category)).toEqual(['dream_comment', 'point_raised'])
    expect(sections[0]?.entries).toEqual([{ body: 'Ada commented', link: 'https://burn.example/dreams' }])
  })

  it('leaves the link out where the installation does not know its own address', async () => {
    build()
    const accountId = await givenAccount()
    await givenUnseen(accountId)

    const sections = await unseenFor(db(), accountId, { since: null, window: DAY, origin: undefined }, NOW)

    expect(sections[0]?.entries[0]?.link).toBeUndefined()
  })

  it('is empty where nothing is unseen', async () => {
    build()
    const accountId = await givenAccount()

    expect(await unseenFor(db(), accountId, { since: null, window: DAY, origin: undefined }, NOW)).toEqual([])
  })

  it('is empty where nothing has arrived since the last digest', async () => {
    build()
    const accountId = await givenAccount()
    await givenUnseen(accountId, { at: ago(5 * DAY) })

    expect(
      await unseenFor(db(), accountId, { since: ago(2 * DAY), window: 7 * DAY, origin: undefined }, NOW),
    ).toEqual([])
  })

  it('drops what is older than the window it is named for', async () => {
    build()
    const accountId = await givenAccount()
    await givenUnseen(accountId, { body: 'old one', at: ago(5 * DAY) })
    await givenUnseen(accountId, { body: 'new one', at: ago(HOUR) })

    const sections = await unseenFor(
      db(),
      accountId,
      { since: ago(2 * DAY), window: DAY, origin: undefined },
      NOW,
    )

    expect(sections[0]?.entries.map((entry) => entry.body)).toEqual(['new one'])
  })

  it('keeps a week of it for somebody who asked for weekly', async () => {
    build()
    const accountId = await givenAccount()
    await givenUnseen(accountId, { body: 'old one', at: ago(5 * DAY) })
    await givenUnseen(accountId, { body: 'new one', at: ago(HOUR) })

    const sections = await unseenFor(
      db(),
      accountId,
      { since: ago(6 * DAY), window: 7 * DAY, origin: undefined },
      NOW,
    )

    expect(sections[0]?.entries.map((entry) => entry.body)).toEqual(['new one', 'old one'])
  })

  it('carries the whole backlog to somebody who has never had one', async () => {
    build()
    const accountId = await givenAccount()
    await givenUnseen(accountId, { body: 'ancient', at: ago(60 * DAY) })
    await givenUnseen(accountId, { body: 'recent', at: ago(HOUR) })

    const sections = await unseenFor(db(), accountId, { since: null, window: DAY, origin: undefined }, NOW)

    expect(sections[0]?.entries.map((entry) => entry.body)).toEqual(['recent', 'ancient'])
  })

  it('never prints again what the last digest already carried', async () => {
    // The guard allows the next one an hour early, so `since` can sit inside the window —
    // and the whole point of windowing is not saying the same thing twice.
    build()
    const accountId = await givenAccount()
    await givenUnseen(accountId, { body: 'was in the last one', at: ago(23 * HOUR) })
    await givenUnseen(accountId, { body: 'new since then', at: ago(HOUR) })

    const sections = await unseenFor(
      db(),
      accountId,
      { since: ago(22 * HOUR), window: DAY, origin: undefined },
      NOW,
    )

    expect(sections[0]?.entries.map((entry) => entry.body)).toEqual(['new since then'])
  })

  it('is empty where everything unseen is older than the window', async () => {
    build()
    const accountId = await givenAccount()
    await givenUnseen(accountId, { body: 'old one', at: ago(5 * DAY) })
    await givenUnseen(accountId, { body: 'newer, but still past it', at: ago(2 * DAY) })

    const sections = await unseenFor(
      db(),
      accountId,
      { since: ago(3 * DAY), window: DAY, origin: undefined },
      NOW,
    )

    expect(sections).toEqual([])
  })

  it('caps what one section carries, and says how much it left out', async () => {
    build()
    const accountId = await givenAccount()
    for (let at = 0; at < MOST_PER_SECTION + 3; at += 1) {
      await givenUnseen(accountId, { body: `comment ${at}`, at: ago(at * HOUR) })
    }

    const [section] = await unseenFor(db(), accountId, { since: null, window: DAY, origin: undefined }, NOW)

    expect(section?.total).toBe(MOST_PER_SECTION + 3)
    expect(section?.entries).toHaveLength(MOST_PER_SECTION)
  })

  it('counts what is waiting rather than what it printed, in the subject', async () => {
    build()
    await givenMailServer()
    const accountId = await givenAccount({ lastActive: ago(3 * DAY) })
    for (let at = 0; at < MOST_PER_SECTION + 3; at += 1) {
      await givenUnseen(accountId, { body: `comment ${at}`, at: ago(at * HOUR) })
    }
    const sent: Message[] = []

    await sweepDigests(
      {
        db: db(),
        send: (_transport, message) => {
          sent.push(message)

          return Promise.resolve()
        },
        origin: 'https://burn.example',
        log: () => undefined,
      },
      NOW,
    )

    expect(sent[0]?.subject).toBe(`The Burning Sage: ${MOST_PER_SECTION + 3} things you have not seen`)
    expect(sent[0]?.text).toContain('and 3 more')
  })
})

it('gives a weekly candidate seven days through the sweep, not one', async () => {
  // Needs a previous digest, or the first-one exception carries everything and the window
  // this test is about decides nothing — which is how the first version of it passed
  // against a hardcoded day.
  build()
  await givenMailServer()
  const accountId = await givenAccount({
    digest: 'weekly',
    lastActive: ago(8 * DAY),
    digestSent: ago(8 * DAY),
  })
  await givenUnseen(accountId, { body: 'four days back', at: ago(4 * DAY) })
  const sent: Message[] = []

  await sweepDigests(
    {
      db: db(),
      send: (_transport, message) => {
        sent.push(message)

        return Promise.resolve()
      },
      origin: 'https://burn.example',
      log: () => undefined,
    },
    NOW,
  )

  expect(sent[0]?.text).toContain('four days back')
})

describe('the night a restart could otherwise skip', () => {
  it('is still due when the last digest went barely under a day ago', async () => {
    build()
    const accountId = await givenAccount({
      lastActive: ago(3 * DAY),
      digestSent: ago(DAY - 30 * 60 * 1000),
    })

    expect((await dueForDigest(db(), NOW)).map((one) => one.account_id)).toEqual([accountId])
  })

  it('is not due when one went a couple of hours ago, which is the same sweep waking twice', async () => {
    build()
    await givenAccount({ lastActive: ago(3 * DAY), digestSent: ago(2 * HOUR) })

    expect(await dueForDigest(db(), NOW)).toEqual([])
  })
})

describe('the nightly sweep', () => {
  const deps = (send: Send) => ({
    db: db(),
    send,
    origin: 'https://burn.example',
    log: vi.fn<(posted: Posted, accountId: string) => void>(),
  })

  it('posts one, and records that it went', async () => {
    build()
    await givenMailServer()
    const accountId = await givenAccount({ lastActive: ago(3 * DAY) })
    await givenUnseen(accountId)
    const send = vi.fn(() => Promise.resolve())

    expect(await sweepDigests(deps(send), NOW)).toBe(1)
    expect(send).toHaveBeenCalledTimes(1)

    const [row] = await db().select({ sent: account.digest_sent_at }).from(account)
    expect(row?.sent).toBe(NOW.toISOString())
  })

  it('sends nothing where no mail server has been set up', async () => {
    build()
    const accountId = await givenAccount({ lastActive: ago(3 * DAY) })
    await givenUnseen(accountId)
    const send = vi.fn(() => Promise.resolve())

    expect(await sweepDigests(deps(send), NOW)).toBe(0)
    expect(send).not.toHaveBeenCalled()
  })

  it('sends nothing to somebody with nothing unseen', async () => {
    build()
    await givenMailServer()
    await givenAccount({ lastActive: ago(3 * DAY) })
    const send = vi.fn(() => Promise.resolve())

    expect(await sweepDigests(deps(send), NOW)).toBe(0)
    expect(send).not.toHaveBeenCalled()
  })

  it('leaves the mark unset when the mail server refuses it, so the next sweep tries again', async () => {
    build()
    await givenMailServer()
    const accountId = await givenAccount({ lastActive: ago(3 * DAY) })
    await givenUnseen(accountId)
    const failing = deps(() => Promise.reject(new Error('550 nope')))

    expect(await sweepDigests(failing, NOW)).toBe(0)

    const [row] = await db().select({ sent: account.digest_sent_at }).from(account)
    expect(row?.sent).toBeNull()
    expect(failing.log).toHaveBeenCalledWith({ sent: false, reason: '550 nope' }, accountId)
  })

  it('says how many things are waiting, in the subject', async () => {
    build()
    await givenMailServer()
    const accountId = await givenAccount({ lastActive: ago(3 * DAY) })
    await givenUnseen(accountId, { body: 'one' })
    await givenUnseen(accountId, { body: 'two' })
    const sent: Message[] = []

    await sweepDigests(
      deps((_transport, message) => {
        sent.push(message)

        return Promise.resolve()
      }),
      NOW,
    )

    expect(sent[0]?.subject).toBe('The Burning Sage: 2 things you have not seen')
    expect(sent[0]?.text).toContain('https://burn.example/dreams')
  })
})

describe('the hour it runs in', () => {
  it('is the small hours, and nothing else', () => {
    expect([0, 1, 2, 3, 4, 5, 12, 23].filter(isNightHour)).toEqual([2, 3, 4])
  })
})
