import type { Activity, Thread, ThreadEntry } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { FeedApi } from './Feed.tsx'

import { apiError } from '../api/client.ts'
import { ViewerProvider } from '../viewer.tsx'
import { Feed } from './Feed.tsx'

afterEach(cleanup)

const ADA: Viewer = {
  status: 'signed-in',
  account: { id: 'a-1', name: 'Ada', avatar: null, roles: ['member'] },
}

const aLine = (over: Partial<Activity> & Pick<Activity, 'id' | 'body'>): Activity => ({
  event_id: 'e-1',
  burn: 'Summer burn',
  category: 'dream_offered',
  link: '/dreams',
  created_at: '2026-08-07T18:00:00.000Z',
  ...over,
})

const TWO: Activity[] = [
  aLine({ id: 'x-1', body: 'Ada offered a dream: Sauna at dawn' }),
  aLine({
    id: 'x-2',
    body: 'Bea is coming.',
    category: 'member_joined',
    link: '/members',
    created_at: '2026-08-07T17:00:00.000Z',
  }),
]

const anEntry = (over: Partial<ThreadEntry> & Pick<ThreadEntry, 'id' | 'body'>): ThreadEntry => ({
  kind: 'comment',
  author: { account_id: 'a-1', name: 'Ada' },
  created_at: '2026-08-07T18:00:00.000Z',
  edited_at: null,
  ...over,
})

const aCard = (over: Partial<Thread> & Pick<Thread, 'id' | 'title'>): Thread => ({
  event_id: 'e-1',
  burn: 'Summer burn',
  entity_type: 'session',
  entity_id: 's-1',
  gone: false,
  entry_count: 1,
  last_at: '2026-08-07T18:00:00.000Z',
  entries: [anEntry({ id: 't-1', body: 'offered this dream', kind: 'offered' })],
  ...over,
})

/** What the server sends somebody who has never touched the settings. */
const DEFAULTS = [
  'meal_role',
  'dream_role',
  'lead_role',
  'payment',
  'waiting_list_near',
  'waiting_list_pushed',
  'dream_comment',
  'application',
] as const

const stub = (over: Partial<FeedApi> = {}, activity: Activity[] = TWO, threads: Thread[] = []): FeedApi => ({
  getFeed: () => Promise.resolve({ activity, threads }),
  getMyNotificationSettings: () => Promise.resolve({ on: [...DEFAULTS], email: [] }),
  updateMyNotificationSettings: () => Promise.resolve({ on: [...DEFAULTS], email: [] }),
  getThread: () => Promise.reject(new Error('getThread is not stubbed here')),
  postComment: () => Promise.reject(new Error('postComment is not stubbed here')),
  updateComment: () => Promise.reject(new Error('updateComment is not stubbed here')),
  deleteComment: () => Promise.reject(new Error('deleteComment is not stubbed here')),
  ...over,
})

const renderPage = (api: FeedApi, viewer: Viewer = ADA) =>
  render(
    <ViewerProvider viewer={viewer}>
      <Feed api={api} />
    </ViewerProvider>,
  )

describe('what everyone has been doing', () => {
  it('shows a line per thing, newest first', async () => {
    renderPage(stub())

    expect(await screen.findByText('Ada offered a dream: Sauna at dawn')).toBeTruthy()
    const lines = [...document.querySelectorAll('.feed-what')].map((one) => one.textContent)
    expect(lines).toEqual(['Ada offered a dream: Sauna at dawn', 'Bea is coming.'])
  })

  it('interleaves the conversations with the news, by when each last moved', async () => {
    // Two things on one page: a dream is a card carrying its own history and talk, and
    // the burn's news stays a line. The order is one order, not two lists.
    renderPage(
      stub(
        {},
        [aLine({ id: 'x-1', body: 'Bea is coming.', created_at: '2026-08-07T19:00:00.000Z' })],
        [
          aCard({ id: 'c-1', title: 'Sauna at dawn', last_at: '2026-08-07T20:00:00.000Z' }),
          aCard({ id: 'c-2', title: 'Cacao ceremony', last_at: '2026-08-07T18:00:00.000Z' }),
        ],
      ),
    )

    await screen.findByText('Sauna at dawn')
    expect(
      [...document.querySelectorAll('.feed-card-head, .feed-what')].map((one) => one.textContent),
    ).toEqual(['Sauna at dawn', 'Bea is coming.', 'Cacao ceremony'])
  })

  it('says nothing about when, on a card nothing has happened on', async () => {
    // `new Date('')` is an Invalid Date, and the card drew it. Reachable by taking back
    // the last comment on a thread from before #375, which has no other entry.
    renderPage(
      stub(
        {},
        [],
        [aCard({ id: 'c-1', title: 'Sauna at dawn', last_at: null, entry_count: 0, entries: [] })],
      ),
    )

    await screen.findByText('Sauna at dawn')
    expect(document.querySelector('.feed-when')?.textContent).toBe('Summer burn')
  })

  it('heads a card with what the dream is called, and links to it at its burn', async () => {
    renderPage(
      stub({}, [], [aCard({ id: 'c-1', title: 'Sauna at dawn', event_id: 'e-2', entity_id: 's-9' })]),
    )

    const link = await screen.findByRole('link', { name: 'Sauna at dawn' })
    expect(link.getAttribute('href')).toBe('/dreams?burn=e-2&dream=s-9')
  })

  it('keeps a withdrawn dream readable, and links nowhere', async () => {
    // The card is the only place its thread can be read: there is no panel to open.
    renderPage(stub({}, [], [aCard({ id: 'c-1', title: 'Sauna at dawn', gone: true })]))

    expect(await screen.findByText(/withdrawn/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Sauna at dawn' })).toBeNull()
  })

  it('draws what somebody said differently from what the app did', async () => {
    renderPage(
      stub(
        {},
        [],
        [
          aCard({
            id: 'c-1',
            title: 'Sauna at dawn',
            entry_count: 2,
            entries: [
              anEntry({ id: 't-1', body: 'offered this dream', kind: 'offered' }),
              anEntry({ id: 't-2', body: 'bring a towel', author: { account_id: 'a-2', name: 'Bea' } }),
            ],
          }),
        ],
      ),
    )

    await screen.findByText('Ada offered this dream')
    expect(document.querySelectorAll('.thread-did')).toHaveLength(1)
    expect(document.querySelectorAll('.thread-said')).toHaveLength(1)
  })

  it('says something on a card, and shows what came back', async () => {
    const posted = vi.fn<FeedApi['postComment']>((id) =>
      Promise.resolve({
        thread: aCard({
          id,
          title: 'Sauna at dawn',
          entry_count: 2,
          entries: [
            anEntry({ id: 't-1', body: 'offered this dream', kind: 'offered' }),
            anEntry({ id: 't-2', body: 'is one person enough?' }),
          ],
        }),
      }),
    )
    renderPage(stub({ postComment: posted }, [], [aCard({ id: 'c-1', title: 'Sauna at dawn' })]))

    const box = await screen.findByLabelText('Say something about Sauna at dawn')
    fireEvent.input(box, { target: { value: 'is one person enough?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Say it' }))

    await waitFor(() => expect(posted).toHaveBeenCalledWith('c-1', { body: 'is one person enough?' }))
    expect(await screen.findByText('is one person enough?')).toBeTruthy()
  })

  it('asks for the rest of a conversation only when there is more of it', async () => {
    // The card carries the end of it, which is what bounds the page and what the
    // installed app keeps on disk. The whole thread is a read of its own.
    const whole = vi.fn<FeedApi['getThread']>((id) =>
      Promise.resolve({
        thread: aCard({
          id,
          title: 'Sauna at dawn',
          entry_count: 2,
          entries: [
            anEntry({ id: 't-0', body: 'offered this dream', kind: 'offered' }),
            anEntry({ id: 't-1', body: 'the earliest thing said' }),
          ],
        }),
      }),
    )
    renderPage(stub({ getThread: whole }, [], [aCard({ id: 'c-1', title: 'Sauna at dawn', entry_count: 4 })]))

    fireEvent.click(await screen.findByRole('button', { name: /Show the whole thread \(4\)/ }))

    await waitFor(() => expect(whole).toHaveBeenCalledWith('c-1'))
    expect(await screen.findByText('the earliest thing said')).toBeTruthy()
  })

  it('offers no way to ask for more when the card already has all of it', async () => {
    renderPage(stub({}, [], [aCard({ id: 'c-1', title: 'Sauna at dawn', entry_count: 1 })]))

    await screen.findByText('Sauna at dawn')
    expect(screen.queryByRole('button', { name: /Show the whole thread/ })).toBeNull()
  })

  it('offers the switch that would tell somebody about a card like this one', async () => {
    // The chip names the top of the card, and only where a category exists to name: a
    // dream being moved sends nothing, so a card whose latest news is a move offers no
    // switch rather than one that would change nothing.
    renderPage(
      stub(
        {},
        [],
        [
          aCard({
            id: 'c-1',
            title: 'Sauna at dawn',
            entries: [anEntry({ id: 't-1', body: 'moved it in the schedule', kind: 'scheduled' })],
          }),
          aCard({
            id: 'c-2',
            title: 'Cacao ceremony',
            entity_id: 's-2',
            last_at: '2026-08-07T17:00:00.000Z',
            entries: [anEntry({ id: 't-2', body: 'bring a cup' })],
          }),
        ],
      ),
    )

    expect(await screen.findByRole('button', { name: /Somebody comments on any dream/ })).toBeTruthy()
    expect(document.querySelectorAll('.feed-chip')).toHaveLength(1)
  })

  it('names the burn each line belongs to, because the page spans them', async () => {
    renderPage(stub({}, [aLine({ id: 'x-1', body: 'Cai is coming.', burn: 'Autumn burn' })]))

    expect(await screen.findByText(/Autumn burn/)).toBeTruthy()
  })

  it('links a line to the page it is about, at the burn it is about', async () => {
    // The page alone was the defect (#333): the links are the notification's, and
    // those are burn-agnostic — so a line about the autumn burn followed while the
    // selector sat on the summer one opened the summer page.
    renderPage(stub({}, [aLine({ id: 'x-1', body: 'Ada offered a dream: Sauna', event_id: 'e-2' })]))

    const link = await screen.findByRole('link', { name: 'Ada offered a dream: Sauna' })
    expect(link.getAttribute('href')).toBe('/dreams?burn=e-2')
  })

  it('puts the burn before a fragment rather than inside it', async () => {
    // None carries one today. Appended after a `#` the query is not a query at all,
    // which is the sort of thing that is cheap now and archaeology later.
    renderPage(stub({}, [aLine({ id: 'x-1', body: 'Ada offered a dream: Sauna', link: '/schedule#s-1' })]))

    const link = await screen.findByRole('link', { name: 'Ada offered a dream: Sauna' })
    expect(link.getAttribute('href')).toBe('/schedule?burn=e-1#s-1')
  })

  it('keeps everything past a second # rather than dropping it', async () => {
    // Also none today. `split('#')` kept the first two pieces and threw the rest away.
    renderPage(stub({}, [aLine({ id: 'x-1', body: 'Ada offered a dream: Sauna', link: '/schedule#s-1#b' })]))

    const link = await screen.findByRole('link', { name: 'Ada offered a dream: Sauna' })
    expect(link.getAttribute('href')).toBe('/schedule?burn=e-1#s-1#b')
  })

  it('keeps a query the link already had', async () => {
    // None carries one today. The joiner is a `&` rather than a second `?` so that
    // stays true of a link somebody adds rather than of this one.
    renderPage(stub({}, [aLine({ id: 'x-1', body: 'Ada offered a dream: Sauna', link: '/dreams?open=s-1' })]))

    const link = await screen.findByRole('link', { name: 'Ada offered a dream: Sauna' })
    expect(link.getAttribute('href')).toBe('/dreams?open=s-1&burn=e-1')
  })

  it('leaves a line with no page of its own as plain text', async () => {
    renderPage(stub({}, [aLine({ id: 'x-1', body: 'Something happened.', link: null })]))

    await screen.findByText('Something happened.')
    expect(screen.queryByRole('link', { name: 'Something happened.' })).toBeNull()
  })

  it('offers to switch the category on, and says it is off', async () => {
    // Half the point of the page: this is where somebody finds the setting, in the
    // moment they have just found the thing interesting (#303).
    const update = vi.fn<FeedApi['updateMyNotificationSettings']>(() =>
      Promise.resolve({ on: [...DEFAULTS, 'dream_offered'], email: [] }),
    )
    renderPage(stub({ updateMyNotificationSettings: update }, [aLine({ id: 'x-1', body: 'A dream.' })]))

    const chip = await screen.findByRole('button', { name: /Somebody offers a dream/ })
    expect(chip.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(chip)

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({ on: [...DEFAULTS, 'dream_offered'], email: [] })
    })
  })

  it('switches one off again, and keeps the email column alone', async () => {
    // The passing sibling, and the reason the whole set goes on the wire: what is sent
    // is what was held plus or minus one.
    const update = vi.fn<FeedApi['updateMyNotificationSettings']>(() =>
      Promise.resolve({ on: [], email: ['meal_role'] }),
    )
    renderPage(
      stub(
        {
          getMyNotificationSettings: () => Promise.resolve({ on: ['dream_offered'], email: ['meal_role'] }),
          updateMyNotificationSettings: update,
        },
        [aLine({ id: 'x-1', body: 'A dream.' })],
      ),
    )

    const chip = await screen.findByRole('button', { name: /Somebody offers a dream/ })
    expect(chip.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(chip)

    await waitFor(() => expect(update).toHaveBeenCalledWith({ on: [], email: ['meal_role'] }))
  })

  it('says so when nothing has happened yet', async () => {
    renderPage(stub({}, []))

    expect(await screen.findByText(/Nothing has happened yet/)).toBeTruthy()
  })

  it('says the read failed rather than showing an empty page', async () => {
    renderPage(stub({ getFeed: () => Promise.reject(apiError(500, 'internal_error', 'Nope.')) }))

    expect(await screen.findByRole('alert')).toBeTruthy()
  })

  it('sends somebody with no role to log in rather than to an empty page', async () => {
    renderPage(stub(), { status: 'signed-out' })

    expect(await screen.findByRole('link', { name: /Log in/ })).toBeTruthy()
  })
})
