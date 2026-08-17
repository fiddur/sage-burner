import type { DigestChoice, ThreadEntryKind } from '@sage-burner/shared'

import { notifiesByDefault } from '@sage-burner/shared'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DbHandle } from '../db/index.ts'
import type { Message, Posted, Send } from './mail.ts'

import { createDb, runMigrations } from '../db/index.ts'
import {
  account,
  accountRole,
  event,
  installation,
  INSTALLATION_ID,
  leadRole,
  mailSetting,
  meetingPoint,
  post,
  song,
  thread,
  threadEntry,
} from '../db/schema.ts'
import { dueForDigest, feedSince, isNightHour, lineFor, MOST_PER_SECTION, sweepDigests } from './digest.ts'

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
  name = 'Ada',
  approved = true,
}: {
  digest?: DigestChoice
  lastActive?: string | null
  digestSent?: string | null
  name?: string
  approved?: boolean
} = {}) => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({
      id,
      name,
      email: `${id}@example.org`,
      password_hash: null,
      created_at: ago(30 * DAY),
      ...(digest === undefined ? {} : { digest }),
      last_active_at: lastActive ?? null,
      digest_sent_at: digestSent ?? null,
    })

  if (approved) await db().insert(accountRole).values({ account_id: id, role: 'member' })

  return id
}

const givenBurn = async (name = 'Burning Sage Autumn') => {
  const id = randomUUID()
  await db()
    .insert(event)
    .values({
      id,
      name,
      slug: `burn-${id}`,
      start_date: '2026-09-18',
      end_date: '2026-09-20',
      member_cap: 42,
      created_at: ago(30 * DAY),
    })

  return id
}

const givenRoleCard = async (
  eventId: string,
  { title = 'Kitchen', at = ago(2 * HOUR) }: { title?: string; at?: string } = {},
) => {
  const roleId = randomUUID()
  const threadId = randomUUID()

  await db()
    .insert(leadRole)
    .values({
      id: roleId,
      event_id: eventId,
      title,
      purpose: '',
      tasks: '',
      effort_before: 'none',
      effort_during: 'none',
      effort_after: 'none',
      team_size_wanted: 0,
      lead_attendance_id: null,
      created_at: ago(10 * DAY),
    })
  await db()
    .insert(thread)
    .values({ id: threadId, event_id: eventId, entity_type: 'role', entity_id: roleId, title })
  await db().insert(threadEntry).values({
    id: randomUUID(),
    thread_id: threadId,
    kind: 'facilitator',
    seq: 1,
    author_account_id: null,
    body: 'is leading it',
    created_at: at,
  })

  return threadId
}

const givenSongCard = async ({
  title = 'Nature of Love',
  deleted = false,
}: { title?: string; deleted?: boolean } = {}) => {
  const songId = randomUUID()
  const threadId = randomUUID()

  await db()
    .insert(song)
    .values({
      id: songId,
      title,
      body: '',
      created_at: ago(10 * DAY),
      ...(deleted ? { deleted_at: ago(HOUR) } : {}),
    })
  await db()
    .insert(thread)
    .values({ id: threadId, event_id: null, entity_type: 'song', entity_id: songId, title })

  return threadId
}

const givenPostCard = async (eventId: string, title = 'Fold count') => {
  const postId = randomUUID()
  const threadId = randomUUID()

  await db()
    .insert(post)
    .values({ id: postId, event_id: eventId, author_account_id: null, title, created_at: ago(10 * DAY) })
  await db()
    .insert(thread)
    .values({ id: threadId, event_id: eventId, entity_type: 'post', entity_id: postId, title })

  return threadId
}

const givenPointCard = async (eventId: string, title = 'Event description') => {
  const pointId = randomUUID()
  const threadId = randomUUID()

  await db()
    .insert(meetingPoint)
    .values({ id: pointId, event_id: eventId, title, created_at: ago(10 * DAY) })
  await db()
    .insert(thread)
    .values({ id: threadId, event_id: eventId, entity_type: 'point', entity_id: pointId, title })

  return threadId
}

const givenEntry = async (
  threadId: string,
  {
    kind = 'comment',
    body = 'said something',
    author = null,
    at = ago(2 * HOUR),
  }: { kind?: ThreadEntryKind; body?: string; author?: string | null; at?: string } = {},
) => {
  await db()
    .insert(threadEntry)
    .values({
      id: randomUUID(),
      thread_id: threadId,
      kind,
      seq: Date.parse(at),
      author_account_id: author,
      body,
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

  it('leaves an account nobody has approved, whose feed this is not', async () => {
    build()
    await givenAccount({ lastActive: ago(3 * DAY), approved: false })

    expect(await dueForDigest(db(), NOW)).toEqual([])
  })

  it('takes an admin who is not a member, since the roles are independent', async () => {
    build()
    const accountId = await givenAccount({ lastActive: ago(3 * DAY), approved: false })
    await db().insert(accountRole).values({ account_id: accountId, role: 'admin' })

    expect((await dueForDigest(db(), NOW)).map((one) => one.account_id)).toEqual([accountId])
  })

  it('takes somebody holding both roles exactly once', async () => {
    build()
    const accountId = await givenAccount({ lastActive: ago(3 * DAY) })
    await db().insert(accountRole).values({ account_id: accountId, role: 'admin' })

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
    await givenAccount({ digest: 'weekly', lastActive: ago(3 * DAY) })

    expect(await dueForDigest(db(), NOW)).toEqual([])
  })

  it('takes the weekly one once the week is up', async () => {
    build()
    const accountId = await givenAccount({ digest: 'weekly', lastActive: ago(8 * DAY) })

    expect((await dueForDigest(db(), NOW)).map((one) => one.account_id)).toEqual([accountId])
  })

  it('leaves somebody who has had one inside the window, however long they have been away', async () => {
    build()
    await givenAccount({ lastActive: ago(30 * DAY), digestSent: ago(2 * HOUR) })

    expect(await dueForDigest(db(), NOW)).toEqual([])
  })

  it('says nothing about digests when nobody has said anything', async () => {
    build()

    expect(await dueForDigest(db(), NOW)).toEqual([])
  })
})

describe('a card in one line', () => {
  const entry = (kind: ThreadEntryKind, body: string, name: string | null) => ({
    id: randomUUID(),
    kind,
    body,
    author: name === null ? null : { account_id: randomUUID(), name },
    created_at: ago(HOUR),
    edited_at: null,
    supporters: [],
    support_count: 0,
    supported_by_me: false,
  })

  it('says the title and what was done', () => {
    expect(
      lineFor({ title: 'Leads – which are needed?', entries: [entry('raised', 'raised this', 'Fredrik')] }),
    ).toBe('Leads – which are needed? — Fredrik raised this')
  })

  it('names one actor once, however many things they did', () => {
    expect(
      lineFor({
        title: 'Nature of Love',
        entries: [
          entry('added', 'put it in the book', 'Fredrik'),
          entry('edited', 'said whose song it is', 'Fredrik'),
        ],
      }),
    ).toBe('Nature of Love — Fredrik put it in the book, said whose song it is')
  })

  it('names the next actor again', () => {
    expect(
      lineFor({
        title: 'Nature of Love',
        entries: [entry('added', 'put it in the book', 'Fredrik'), entry('renamed', 'renamed it', 'Bo')],
      }),
    ).toBe('Nature of Love — Fredrik put it in the book; Bo renamed it')
  })

  it('says Somebody where the account is gone', () => {
    expect(
      lineFor({ title: 'Planning call', entries: [entry('scheduled', 'put it in the diary', null)] }),
    ).toBe('Planning call — Somebody put it in the diary')
  })

  it('counts comments rather than quoting them', () => {
    expect(
      lineFor({
        title: 'Event description',
        entries: [entry('comment', 'a whole paragraph nobody wants in an email', 'Fredrik')],
      }),
    ).toBe('Event description — +1 comment')
  })

  it('pluralises the count', () => {
    expect(
      lineFor({
        title: 'Event description',
        entries: [entry('comment', 'one', 'Ada'), entry('comment', 'two', 'Bo')],
      }),
    ).toBe('Event description — +2 comments')
  })

  it('puts the count after the verbs where there are both', () => {
    expect(
      lineFor({
        title: 'Event description',
        entries: [entry('raised', 'raised this', 'Fredrik'), entry('comment', 'a paragraph', 'Fredrik')],
      }),
    ).toBe('Event description — Fredrik raised this (+1 comment)')
  })

  it('is nothing at all where nothing happened past the cut', () => {
    expect(lineFor({ title: 'Event description', entries: [] })).toBeUndefined()
  })
})

describe('what a digest holds', () => {
  it('gathers the cards under the feed’s own headings, in its own order', async () => {
    build()
    const burn = await givenBurn()
    await givenRoleCard(burn)
    const card = await givenPointCard(burn)
    await givenEntry(card, { kind: 'raised', body: 'raised this' })

    const sections = await feedSince(db(), { after: null, origin: 'https://burn.example' })

    expect(sections.map((section) => section.label)).toEqual(['Points', 'Leads'])
    expect(sections[1]?.entries).toEqual([
      {
        body: 'Kitchen — Somebody is leading it',
        burn: 'Burning Sage Autumn',
        link: `https://burn.example/roles?burn=${burn}`,
      },
    ])
  })

  it('says which burn a line is about, so two same-titled ones are not one line twice', async () => {
    build()
    const boundary = await givenBurn('Boundary Burn')
    const midsummer = await givenBurn('Midsummer Burn')
    await givenRoleCard(boundary, { title: 'Kitchen lead' })
    await givenRoleCard(midsummer, { title: 'Kitchen lead', at: ago(HOUR) })

    const sections = await feedSince(db(), { after: null, origin: 'https://burn.example' })

    expect(sections[0]?.entries).toEqual([
      {
        body: 'Kitchen lead — Somebody is leading it',
        burn: 'Midsummer Burn',
        link: `https://burn.example/roles?burn=${midsummer}`,
      },
      {
        body: 'Kitchen lead — Somebody is leading it',
        burn: 'Boundary Burn',
        link: `https://burn.example/roles?burn=${boundary}`,
      },
    ])
  })

  it('calls the songbook by its name, a song belonging to no burn', async () => {
    build()
    const card = await givenSongCard()
    await givenEntry(card, { kind: 'added', body: 'put it in the book' })

    const sections = await feedSince(db(), { after: null, origin: undefined })

    expect(sections[0]?.entries[0]?.burn).toBe('Songbook')
  })

  it('gives a Posts line somewhere to go, its burn’s slice of the feed', async () => {
    build()
    const burn = await givenBurn()
    const card = await givenPostCard(burn)
    await givenEntry(card, { kind: 'posted', body: 'announced this' })

    const sections = await feedSince(db(), { after: null, origin: 'https://burn.example' })

    expect(sections[0]?.entries[0]?.link).toBe(`https://burn.example/feed?kinds=post&burn=${burn}`)
  })

  it('carries a card nothing but a comment has touched', async () => {
    build()
    const burn = await givenBurn()
    const who = await givenAccount()
    const card = await givenPointCard(burn)
    await givenEntry(card, { kind: 'raised', body: 'raised this', at: ago(9 * DAY) })
    await givenEntry(card, { kind: 'comment', body: 'a paragraph', author: who, at: ago(HOUR) })

    const sections = await feedSince(db(), { after: ago(2 * DAY), origin: undefined })

    expect(sections[0]?.entries.map((one) => one.body)).toEqual(['Event description — +1 comment'])
  })

  it('counts only the comments past the cut, not the whole conversation', async () => {
    build()
    const burn = await givenBurn()
    const who = await givenAccount()
    const card = await givenPointCard(burn)
    for (const at of [9 * DAY, 8 * DAY, HOUR, 2 * HOUR]) {
      await givenEntry(card, { kind: 'comment', body: 'a paragraph', author: who, at: ago(at) })
    }

    const sections = await feedSince(db(), { after: ago(2 * DAY), origin: undefined })

    expect(sections[0]?.entries.map((one) => one.body)).toEqual(['Event description — +2 comments'])
  })

  it('drops a card nothing has touched since the cut', async () => {
    build()
    const card = await givenPointCard(await givenBurn())
    await givenEntry(card, { kind: 'raised', body: 'raised this', at: ago(9 * DAY) })

    expect(await feedSince(db(), { after: ago(2 * DAY), origin: undefined })).toEqual([])
  })

  it('drops a card whose thing has been taken back', async () => {
    build()
    const card = await givenSongCard({ deleted: true })
    await givenEntry(card, { kind: 'added', body: 'put it in the book' })

    expect(await feedSince(db(), { after: null, origin: undefined })).toEqual([])
  })

  it('keeps the song that is still there', async () => {
    build()
    const card = await givenSongCard()
    await givenEntry(card, { kind: 'added', body: 'put it in the book' })

    const sections = await feedSince(db(), { after: null, origin: undefined })

    expect(sections.map((section) => section.label)).toEqual(['Songs'])
  })

  it('leaves the link out where the installation does not know its own address', async () => {
    build()
    const burn = await givenBurn()
    await givenRoleCard(burn)

    const sections = await feedSince(db(), { after: null, origin: undefined })

    expect(sections[0]?.entries[0]?.link).toBeUndefined()
  })

  it('is empty where nothing has happened at all', async () => {
    build()

    expect(await feedSince(db(), { after: null, origin: undefined })).toEqual([])
  })

  it('is empty where everything is older than the cut', async () => {
    build()
    const burn = await givenBurn()
    await givenRoleCard(burn, { at: ago(5 * DAY) })

    expect(await feedSince(db(), { after: ago(2 * DAY), origin: undefined })).toEqual([])
  })

  it('carries the whole backlog where nothing has been mailed yet', async () => {
    build()
    const burn = await givenBurn()
    await givenRoleCard(burn, { title: 'ancient', at: ago(60 * DAY) })
    await givenRoleCard(burn, { title: 'recent', at: ago(HOUR) })

    const sections = await feedSince(db(), { after: null, origin: undefined })

    expect(sections[0]?.entries.map((one) => one.body)).toEqual([
      'recent — Somebody is leading it',
      'ancient — Somebody is leading it',
    ])
  })

  it('caps what one section carries, and says how much it left out', async () => {
    build()
    const burn = await givenBurn()
    for (let at = 0; at < MOST_PER_SECTION + 3; at += 1) {
      await givenRoleCard(burn, { title: `line ${at}`, at: ago(at * HOUR) })
    }

    const [section] = await feedSince(db(), { after: null, origin: undefined })

    expect(section?.total).toBe(MOST_PER_SECTION + 3)
    expect(section?.entries).toHaveLength(MOST_PER_SECTION)
  })

  it('carries what no notification would have been written for, nobody having asked', async () => {
    build()
    const card = await givenPointCard(await givenBurn())
    await givenEntry(card, { kind: 'raised', body: 'raised this' })

    const sections = await feedSince(db(), { after: null, origin: undefined })

    expect(notifiesByDefault('point_raised')).toBe(false)
    expect(sections.map((section) => section.label)).toEqual(['Points'])
  })
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

  const collecting = (sent: Message[]) => (_transport: unknown, message: Message) => {
    sent.push(message)

    return Promise.resolve()
  }

  it('posts one, and records that it went', async () => {
    build()
    await givenMailServer()
    await givenAccount({ lastActive: ago(3 * DAY) })
    await givenRoleCard(await givenBurn())
    const send = vi.fn(() => Promise.resolve())

    expect(await sweepDigests(deps(send), NOW)).toBe(1)
    expect(send).toHaveBeenCalledTimes(1)

    const [row] = await db().select({ sent: account.digest_sent_at }).from(account)
    expect(row?.sent).toBe(NOW.toISOString())
  })

  it('cuts at the last digest where that is later than the last visit', async () => {
    build()
    await givenMailServer()
    await givenAccount({ lastActive: ago(10 * DAY), digestSent: ago(2 * DAY) })
    const burn = await givenBurn()
    await givenRoleCard(burn, { title: 'already sent to them', at: ago(5 * DAY) })
    await givenRoleCard(burn, { title: 'since that digest', at: ago(HOUR) })
    const sent: Message[] = []

    await sweepDigests(deps(collecting(sent)), NOW)

    expect(sent[0]?.text).toContain('since that digest')
    expect(sent[0]?.text).not.toContain('already sent to them')
  })

  it('cuts at the last visit where that is later than the last digest', async () => {
    build()
    await givenMailServer()
    await givenAccount({ lastActive: ago(5 * DAY), digestSent: ago(10 * DAY) })
    const burn = await givenBurn()
    await givenRoleCard(burn, { title: 'before they came back', at: ago(7 * DAY) })
    await givenRoleCard(burn, { title: 'after they left again', at: ago(HOUR) })
    const sent: Message[] = []

    await sweepDigests(deps(collecting(sent)), NOW)

    expect(sent[0]?.text).toContain('after they left again')
    expect(sent[0]?.text).not.toContain('before they came back')
  })

  it('cuts at the last visit where nobody has had a digest yet', async () => {
    build()
    await givenMailServer()
    await givenAccount({ lastActive: ago(10 * DAY) })
    await givenRoleCard(await givenBurn(), { title: 'while they were gone', at: ago(5 * DAY) })
    const sent: Message[] = []

    await sweepDigests(deps(collecting(sent)), NOW)

    expect(sent[0]?.text).toContain('while they were gone')
  })

  it('sends nothing where no mail server has been set up', async () => {
    build()
    await givenAccount({ lastActive: ago(3 * DAY) })
    await givenRoleCard(await givenBurn())
    const send = vi.fn(() => Promise.resolve())

    expect(await sweepDigests(deps(send), NOW)).toBe(0)
    expect(send).not.toHaveBeenCalled()
  })

  it('sends nothing where nothing has happened', async () => {
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
    await givenRoleCard(await givenBurn())
    const failing = deps(() => Promise.reject(new Error('550 nope')))

    expect(await sweepDigests(failing, NOW)).toBe(0)

    const [row] = await db().select({ sent: account.digest_sent_at }).from(account)
    expect(row?.sent).toBeNull()
    expect(failing.log).toHaveBeenCalledWith({ sent: false, reason: '550 nope' }, accountId)
  })

  it('says how many things happened, in the subject', async () => {
    build()
    await givenMailServer()
    await givenAccount({ lastActive: ago(3 * DAY) })
    const burn = await givenBurn()
    await givenRoleCard(burn, { title: 'one' })
    await givenRoleCard(burn, { title: 'two', at: ago(3 * HOUR) })
    const sent: Message[] = []

    await sweepDigests(deps(collecting(sent)), NOW)

    expect(sent[0]?.subject).toBe('The Burning Sage: 2 things while you were away')
    expect(sent[0]?.text).toContain('https://burn.example/roles')
  })

  it('counts what is waiting rather than what it printed, in the subject', async () => {
    build()
    await givenMailServer()
    await givenAccount({ lastActive: ago(3 * DAY) })
    const burn = await givenBurn()
    for (let at = 0; at < MOST_PER_SECTION + 3; at += 1) {
      await givenRoleCard(burn, { title: `line ${at}`, at: ago(at * HOUR) })
    }
    const sent: Message[] = []

    await sweepDigests(deps(collecting(sent)), NOW)

    expect(sent[0]?.subject).toBe(`The Burning Sage: ${MOST_PER_SECTION + 3} things while you were away`)
    expect(sent[0]?.text).toContain('and 3 more')
  })

  it('sends nothing to somebody nobody has approved', async () => {
    build()
    await givenMailServer()
    await givenAccount({ lastActive: ago(3 * DAY), approved: false })
    await givenRoleCard(await givenBurn())
    const send = vi.fn(() => Promise.resolve())

    expect(await sweepDigests(deps(send), NOW)).toBe(0)
    expect(send).not.toHaveBeenCalled()
  })
})

describe('the hour it runs in', () => {
  it('is the small hours, and nothing else', () => {
    expect([0, 1, 2, 3, 4, 5, 12, 23].filter(isNightHour)).toEqual([2, 3, 4])
  })
})
