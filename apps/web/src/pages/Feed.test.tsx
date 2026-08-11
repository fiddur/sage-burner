import type { Activity, MyBurn, Thread, ThreadEntry } from '@sage-burner/shared'

import { mentionsIn, mentionToken, notificationCategoryInfo } from '@sage-burner/shared'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { LocationProvider } from 'preact-iso'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { FeedApi } from './Feed.tsx'

import { apiError } from '../api/client.ts'
import { BurnProvider } from '../burn.tsx'
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
  link: '/dreams?burn=e-1&dream=s-1',
  body: null,
  own: false,
  gone: false,
  entry_count: 1,
  supporters: [],
  support_count: 0,
  supported_by_me: false,
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
  supportThread: () => Promise.reject(new Error('supportThread is not stubbed here')),
  withdrawSupportForThread: () => Promise.reject(new Error('withdrawSupportForThread is not stubbed here')),
  addPost: () => Promise.reject(new Error('addPost is not stubbed here')),
  getEventAttendees: () =>
    Promise.resolve({
      attendees: [
        { account_id: 'a-1', name: 'Ada', avatar: null },
        { account_id: 'a-2', name: 'Bea', avatar: null },
      ],
    }),
  getApprovedAccounts: () =>
    Promise.resolve({
      accounts: [
        { account_id: 'a-1', name: 'Ada', avatar: null },
        { account_id: 'a-3', name: 'Cy', avatar: null },
      ],
    }),
  updatePost: () => Promise.reject(new Error('updatePost is not stubbed here')),
  deletePost: () => Promise.reject(new Error('deletePost is not stubbed here')),
  uploadImage: () => Promise.reject(new Error('uploadImage is not stubbed here')),
  postComment: () => Promise.reject(new Error('postComment is not stubbed here')),
  updateComment: () => Promise.reject(new Error('updateComment is not stubbed here')),
  deleteComment: () => Promise.reject(new Error('deleteComment is not stubbed here')),
  ...over,
})

const BURN: MyBurn = {
  event: {
    id: 'e-1',
    name: 'Summer burn',
    slug: 'summer-burn',
    start_date: '2026-08-01',
    end_date: '2026-08-05',
    start_time: '16:00',
    end_time: '12:00',
  },
  attendance: null,
}

const renderPage = (api: FeedApi, viewer: Viewer = ADA, burn: MyBurn | null = BURN) =>
  render(
    <ViewerProvider viewer={viewer}>
      <BurnProvider
        value={{ status: 'ready', burns: burn === null ? [] : [burn], selected: burn ?? undefined }}
      >
        <Feed api={api} />
      </BurnProvider>
    </ViewerProvider>,
  )

/**
 * The same, under the router — which is where the chip row's filter is read from and
 * written to (#472).
 *
 * `LocationProvider` reads `location` on mount, so the address is set first.
 */
const renderPageAt = (at: string, api: FeedApi) => {
  history.replaceState(null, '', at)

  return render(
    <LocationProvider>
      <ViewerProvider viewer={ADA}>
        <BurnProvider value={{ status: 'ready', burns: [BURN], selected: BURN }}>
          <Feed api={api} />
        </BurnProvider>
      </ViewerProvider>
    </LocationProvider>,
  )
}

describe('the chip row over the feed', () => {
  it('asks the server for nothing in particular until somebody taps a chip', async () => {
    const getFeed = vi.fn<FeedApi['getFeed']>(() => Promise.resolve({ activity: TWO, threads: [] }))
    renderPageAt('/feed', stub({ getFeed }))

    await screen.findByRole('button', { name: 'Everything' })
    expect(getFeed).toHaveBeenCalledWith([], expect.anything())
  })

  it('puts what a chip means in the address, so the filter is shareable and back undoes it', async () => {
    renderPageAt('/feed', stub())

    fireEvent.click(await screen.findByRole('button', { name: 'Dreams' }))

    await waitFor(() => expect(location.search).toBe('?kinds=session'))
  })

  it('asks the server for what the address says, since the page reads only the newest fifty', async () => {
    const getFeed = vi.fn<FeedApi['getFeed']>(() => Promise.resolve({ activity: [], threads: [] }))
    renderPageAt('/feed?kinds=song', stub({ getFeed }))

    await screen.findByRole('button', { name: 'Songs' })
    expect(getFeed).toHaveBeenCalledWith(['song'], expect.anything())
  })

  it('lights only what is asked for, so the row itself says the page is filtered', async () => {
    renderPageAt('/feed?kinds=song', stub())

    expect((await screen.findByRole('button', { name: 'Songs' })).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Dreams' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: 'Everything' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('has a chip for the burn news beside the ones for cards', async () => {
    renderPageAt('/feed', stub())

    for (const name of ['Burns', 'Dreams', 'People', 'Posts', 'Songs']) {
      expect(await screen.findByRole('button', { name })).toBeTruthy()
    }
  })
})

describe('the heart on a card', () => {
  it('is offered on every kind of card, not only on a dream', async () => {
    renderPage(
      stub({}, [], [aCard({ id: 'c-1', title: 'The planning call is Sunday', entity_type: 'post' })]),
    )

    expect(
      await screen.findByRole('button', { name: 'Give a heart to The planning call is Sunday' }),
    ).toBeTruthy()
  })

  it('shows the count and that it is yours', async () => {
    renderPage(
      stub({}, [], [aCard({ id: 'c-1', title: 'Sauna at dawn', support_count: 3, supported_by_me: true })]),
    )

    const heart = await screen.findByRole('button', { name: 'Take back your heart for Sauna at dawn' })
    expect(heart.getAttribute('aria-pressed')).toBe('true')
    expect(heart.textContent).toContain('3')
  })

  it('gives one', async () => {
    const supportThread = vi.fn<FeedApi['supportThread']>(() =>
      Promise.resolve({
        thread: aCard({ id: 'c-1', title: 'Sauna at dawn', support_count: 1, supported_by_me: true }),
      }),
    )
    renderPage(stub({ supportThread }, [], [aCard({ id: 'c-1', title: 'Sauna at dawn' })]))

    fireEvent.click(await screen.findByRole('button', { name: 'Give a heart to Sauna at dawn' }))

    await waitFor(() => expect(supportThread).toHaveBeenCalledWith('c-1'))
  })

  it('takes it back', async () => {
    const withdrawSupportForThread = vi.fn<FeedApi['withdrawSupportForThread']>(() =>
      Promise.resolve({ thread: aCard({ id: 'c-1', title: 'Sauna at dawn' }) }),
    )
    renderPage(
      stub(
        { withdrawSupportForThread },
        [],
        [aCard({ id: 'c-1', title: 'Sauna at dawn', support_count: 1, supported_by_me: true })],
      ),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Take back your heart for Sauna at dawn' }))

    await waitFor(() => expect(withdrawSupportForThread).toHaveBeenCalledWith('c-1'))
  })

  it('says no number where nobody has given one', async () => {
    renderPage(stub({}, [], [aCard({ id: 'c-1', title: 'Sauna at dawn' })]))

    expect((await screen.findByRole('button', { name: 'Give a heart to Sauna at dawn' })).textContent).toBe(
      '♡',
    )
  })
})

describe('announcing something on the feed', () => {
  it('sends the title and the body to the burn the bar has chosen', async () => {
    const addPost = vi.fn<FeedApi['addPost']>(() =>
      Promise.resolve({
        post: {
          id: 'p-1',
          event_id: 'e-1',
          author_account_id: 'a-1',
          title: 'The planning call is Sunday',
          body: 'Come.',
          withdrawn_at: null,
          created_at: '2026-08-07T18:00:00.000Z',
        },
      }),
    )
    renderPage(stub({ addPost }))

    fireEvent.click(await screen.findByRole('button', { name: 'Announce something' }))
    fireEvent.input(screen.getByLabelText('What you are announcing'), {
      target: { value: '  The planning call is Sunday  ' },
    })
    fireEvent.input(screen.getByLabelText('What you want to say about it'), { target: { value: ' Come. ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Announce it' }))

    await waitFor(() =>
      expect(addPost).toHaveBeenCalledWith('e-1', { title: 'The planning call is Sunday', body: 'Come.' }),
    )
  })

  it('will not send one with nothing to announce', async () => {
    const addPost = vi.fn<FeedApi['addPost']>()
    renderPage(stub({ addPost }))

    fireEvent.click(await screen.findByRole('button', { name: 'Announce something' }))
    fireEvent.input(screen.getByLabelText('What you are announcing'), { target: { value: '   ' } })

    expect(screen.getByRole('button', { name: 'Announce it' })).toHaveProperty('disabled', true)
    expect(addPost).not.toHaveBeenCalled()
  })

  it('offers nothing to announce to before a burn is chosen', async () => {
    renderPage(stub(), ADA, null)

    await waitFor(() => expect(screen.getByText('Ada offered a dream: Sauna at dawn')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Announce something' })).toBeNull()
  })

  it('offers whoever is coming after an @, and sends a token carrying the id', async () => {
    const addPost = vi.fn<FeedApi['addPost']>(() =>
      Promise.resolve({
        post: {
          id: 'p-1',
          event_id: 'e-1',
          author_account_id: 'a-1',
          title: 'Sunday',
          body: '',
          withdrawn_at: null,
          created_at: '2026-08-07T18:00:00.000Z',
        },
      }),
    )
    renderPage(stub({ addPost }))

    fireEvent.click(await screen.findByRole('button', { name: 'Announce something' }))
    fireEvent.input(screen.getByLabelText('What you are announcing'), { target: { value: 'Sunday' } })
    const box = screen.getByLabelText('What you want to say about it')
    fireEvent.input(box, { target: { value: 'ask @Be' } })
    fireEvent.keyUp(box, { target: { selectionStart: 7 } })

    fireEvent.click(await screen.findByRole('button', { name: '@Bea' }))
    fireEvent.click(screen.getByRole('button', { name: 'Announce it' }))

    await waitFor(() => expect(addPost).toHaveBeenCalled())
    const [, sent] = addPost.mock.calls[0] ?? []
    expect(mentionsIn(sent?.body ?? '')).toEqual([{ name: 'Bea', target: 'a-2' }])
  })

  it('offers whoever is coming to the burn that is chosen now, not the one before it', async () => {
    const getEventAttendees = vi.fn<FeedApi['getEventAttendees']>((eventId: string) =>
      Promise.resolve({
        attendees:
          eventId === 'e-1'
            ? [{ account_id: 'a-1', name: 'Ada', avatar: null }]
            : [{ account_id: 'a-7', name: 'Zed', avatar: null }],
      }),
    )
    const other: MyBurn = { event: { ...BURN.event, id: 'e-2', name: 'Autumn burn' }, attendance: null }
    const { rerender } = render(
      <ViewerProvider viewer={ADA}>
        <BurnProvider value={{ status: 'ready', burns: [BURN, other], selected: BURN }}>
          <Feed api={stub({ getEventAttendees })} />
        </BurnProvider>
      </ViewerProvider>,
    )
    await waitFor(() => expect(getEventAttendees).toHaveBeenCalledWith('e-1', expect.anything()))

    rerender(
      <ViewerProvider viewer={ADA}>
        <BurnProvider value={{ status: 'ready', burns: [BURN, other], selected: other }}>
          <Feed api={stub({ getEventAttendees })} />
        </BurnProvider>
      </ViewerProvider>,
    )

    await waitFor(() => expect(getEventAttendees).toHaveBeenCalledWith('e-2', expect.anything()))
  })

  it('offers no names on a card from another burn, since they could not be reached', async () => {
    // The feed spans burns; the attendee list is the one in the bar. `namedBy` would drop a name
    // from the wrong burn silently, so the menu must not offer it — `@everybody` still works,
    // because the server resolves that from the card's own event.
    renderPage(
      stub({}, [], [aCard({ id: 'c-1', title: 'Sauna at dusk', event_id: 'e-2', burn: 'Autumn burn' })]),
    )

    const box = await screen.findByLabelText('Say something about Sauna at dusk')
    fireEvent.input(box, { target: { value: 'ask @Be' } })
    fireEvent.keyUp(box, { target: { selectionStart: 7 } })

    expect(screen.queryByRole('button', { name: '@Bea' })).toBeNull()
  })

  it('offers them on a card from the burn in the bar', async () => {
    renderPage(stub({}, [], [aCard({ id: 'c-1', title: 'Sauna at dawn', event_id: 'e-1' })]))

    const box = await screen.findByLabelText('Say something about Sauna at dawn')
    fireEvent.input(box, { target: { value: 'ask @Be' } })
    fireEvent.keyUp(box, { target: { selectionStart: 7 } })

    expect(screen.getByRole('button', { name: '@Bea' })).toBeTruthy()
  })

  it('offers the whole burn as well, which is nobody in the list', async () => {
    renderPage(stub())

    fireEvent.click(await screen.findByRole('button', { name: 'Announce something' }))
    const box = screen.getByLabelText('What you want to say about it')
    fireEvent.input(box, { target: { value: '@' } })
    fireEvent.keyUp(box, { target: { selectionStart: 1 } })

    expect(await screen.findByRole('button', { name: '@everybody' })).toBeTruthy()
  })

  it('offers nobody for something that only looks like an address', async () => {
    renderPage(stub())

    fireEvent.click(await screen.findByRole('button', { name: 'Announce something' }))
    const box = screen.getByLabelText('What you want to say about it')
    fireEvent.input(box, { target: { value: 'write to bea@example.org' } })
    fireEvent.keyUp(box, { target: { selectionStart: 24 } })

    expect(screen.queryByRole('button', { name: '@everybody' })).toBeNull()
    expect(screen.queryByRole('button', { name: '@Bea' })).toBeNull()
  })

  it('draws a mention as a link to the person it names', async () => {
    renderPage(
      stub(
        {},
        [],
        [
          aCard({
            id: 'c-1',
            title: 'Sunday',
            entity_type: 'post',
            link: null,
            body: `ask ${mentionToken('Bea', 'a-2')}`,
          }),
        ],
      ),
    )

    const link = await screen.findByRole('link', { name: '@Bea' })
    expect(link.getAttribute('href')).toBe('/members/a-2')
  })

  it('says who will see it, so nobody announces to the wrong burn', async () => {
    renderPage(stub())

    fireEvent.click(await screen.findByRole('button', { name: 'Announce something' }))

    expect(screen.getByText(/Everyone coming to Summer burn will see this/)).toBeTruthy()
  })
})

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

  it('heads a card with what it is called, and links where the card says', async () => {
    renderPage(
      stub({}, [], [aCard({ id: 'c-1', title: 'Sauna at dawn', link: '/dreams?burn=e-2&dream=s-9' })]),
    )

    const link = await screen.findByRole('link', { name: 'Sauna at dawn' })
    expect(link.getAttribute('href')).toBe('/dreams?burn=e-2&dream=s-9')
  })

  it('keeps a withdrawn dream readable, and links nowhere', async () => {
    renderPage(stub({}, [], [aCard({ id: 'c-1', title: 'Sauna at dawn', gone: true, link: null })]))

    expect(await screen.findByText(/withdrawn/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Sauna at dawn' })).toBeNull()
  })

  it('says somebody is no longer coming rather than withdrawn, on their own card', async () => {
    renderPage(
      stub({}, [], [aCard({ id: 'c-1', title: 'Ada', entity_type: 'attendance', gone: true, link: null })]),
    )

    expect(await screen.findByText(/no longer coming/)).toBeTruthy()
    expect(screen.queryByText(/withdrawn/)).toBeNull()
  })

  it('carries somebody’s introduction in the top of their card', async () => {
    renderPage(
      stub(
        {},
        [],
        [
          aCard({
            id: 'c-1',
            title: 'Ada',
            entity_type: 'attendance',
            link: '/members/a-1',
            body: 'I build **saunas**.',
            entries: [anEntry({ id: 't-1', body: 'says who they are', kind: 'introduced' })],
          }),
        ],
      ),
    )

    expect(await screen.findByText('saunas')).toBeTruthy()
    expect((await screen.findByRole('link', { name: 'Ada' })).getAttribute('href')).toBe('/members/a-1')
  })

  it('says an announcement was taken back, not that somebody is no longer coming', async () => {
    renderPage(
      stub(
        {},
        [],
        [
          aCard({
            id: 'c-1',
            title: 'The planning call is Sunday',
            entity_type: 'post',
            link: null,
            gone: true,
          }),
        ],
      ),
    )

    expect(await screen.findByText(/taken back/)).toBeTruthy()
    expect(screen.queryByText(/no longer coming|withdrawn/)).toBeNull()
  })

  it('offers rewording and taking back to whoever the server says it is theirs', async () => {
    const updatePost = vi.fn<FeedApi['updatePost']>(() =>
      Promise.resolve({
        post: {
          id: 's-1',
          event_id: 'e-1',
          author_account_id: 'a-1',
          title: 'Monday, not Sunday',
          body: '',
          withdrawn_at: null,
          created_at: '2026-08-07T18:00:00.000Z',
        },
      }),
    )
    renderPage(
      stub(
        { updatePost },
        [],
        [
          aCard({
            id: 'c-1',
            title: 'Sunday',
            entity_type: 'post',
            entity_id: 's-1',
            link: null,
            body: 'Come.',
            own: true,
          }),
        ],
      ),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Reword it' }))
    fireEvent.input(screen.getByLabelText('What Sunday is'), { target: { value: ' Monday, not Sunday ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updatePost).toHaveBeenCalledWith('s-1', { title: 'Monday, not Sunday', body: 'Come.' }),
    )
  })

  it('takes one back by the entity it is about, not by the thread', async () => {
    const deletePost = vi.fn<FeedApi['deletePost']>(() => Promise.resolve(undefined))
    renderPage(
      stub(
        { deletePost },
        [],
        [aCard({ id: 'c-1', title: 'Sunday', entity_type: 'post', entity_id: 's-1', link: null, own: true })],
      ),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Take back Sunday' }))

    await waitFor(() => expect(deletePost).toHaveBeenCalledWith('s-1'))
  })

  it('stops showing the expanded copy of a card it has just reworded', async () => {
    const stale = aCard({
      id: 'c-1',
      title: 'Stale title',
      entity_type: 'post',
      entity_id: 's-1',
      link: null,
      own: true,
    })
    const updatePost = vi.fn<FeedApi['updatePost']>(() =>
      Promise.resolve({
        post: {
          id: 's-1',
          event_id: 'e-1',
          author_account_id: 'a-1',
          title: 'Monday',
          body: '',
          withdrawn_at: null,
          created_at: '2026-08-07T18:00:00.000Z',
        },
      }),
    )
    renderPage(
      stub(
        { updatePost, postComment: () => Promise.resolve({ thread: stale }) },
        [],
        [{ ...stale, title: 'Sunday' }],
      ),
    )

    fireEvent.input(await screen.findByLabelText('Say something about Sunday'), {
      target: { value: 'noted' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Say it' }))
    await waitFor(() => expect(screen.getByText('Stale title')).toBeTruthy())
    // Enabled, not merely present: a click on a disabled button is a no-op and the next
    // `getByRole` would then fail on the form that never opened.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Reword it' })).toHaveProperty('disabled', false),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Reword it' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.queryByText('Stale title')).toBeNull())
    expect(screen.getByText('Sunday')).toBeTruthy()
  })

  it('keeps what was typed when a rewording is refused', async () => {
    renderPage(
      stub(
        { updatePost: () => Promise.reject(apiError(500, 'internal', 'Nope.')) },
        [],
        [aCard({ id: 'c-1', title: 'Sunday', entity_type: 'post', entity_id: 's-1', link: null, own: true })],
      ),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Reword it' }))
    fireEvent.input(screen.getByLabelText('What Sunday is'), { target: { value: 'Monday' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Nope.')
    expect(screen.getByLabelText('What Sunday is')).toHaveProperty('value', 'Monday')
  })

  it('offers an organiser the take-back but not the rewording, which the route refuses them', async () => {
    const BOSS: Viewer = {
      status: 'signed-in',
      account: { id: 'a-9', name: 'Cai', avatar: null, roles: ['admin', 'member'] },
    }
    renderPage(
      stub(
        {},
        [],
        [
          aCard({
            id: 'c-1',
            title: 'Sunday',
            entity_type: 'post',
            entity_id: 's-1',
            link: null,
            own: false,
          }),
        ],
      ),
      BOSS,
    )

    expect(await screen.findByRole('button', { name: 'Take back Sunday' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reword it' })).toBeNull()
  })

  it('offers an organiser nothing on a card that is not an announcement', async () => {
    const BOSS: Viewer = {
      status: 'signed-in',
      account: { id: 'a-9', name: 'Cai', avatar: null, roles: ['admin', 'member'] },
    }
    renderPage(stub({}, [], [aCard({ id: 'c-1', title: 'Sauna at dawn', own: false })]), BOSS)

    await waitFor(() => expect(screen.getByText('Sauna at dawn')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Take back Sauna at dawn' })).toBeNull()
  })

  it('offers neither to somebody it is not theirs', async () => {
    renderPage(
      stub(
        {},
        [],
        [
          aCard({
            id: 'c-1',
            title: 'Sunday',
            entity_type: 'post',
            entity_id: 's-1',
            link: null,
            own: false,
          }),
        ],
      ),
    )

    await waitFor(() => expect(screen.getByText('Sunday')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Reword it' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Take back Sunday' })).toBeNull()
  })

  it('keeps what was typed when an announcement is refused', async () => {
    renderPage(stub({ addPost: () => Promise.reject(apiError(500, 'internal', 'Nope.')) }))

    fireEvent.click(await screen.findByRole('button', { name: 'Announce something' }))
    fireEvent.input(screen.getByLabelText('What you are announcing'), { target: { value: 'Sunday' } })
    fireEvent.click(screen.getByRole('button', { name: 'Announce it' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Nope.')
    expect(screen.getByLabelText('What you are announcing')).toHaveProperty('value', 'Sunday')
  })

  it('offers an announcement’s own switch, not a dream’s', async () => {
    renderPage(
      stub(
        {},
        [],
        [
          aCard({
            id: 'c-1',
            title: 'The planning call is Sunday',
            entity_type: 'post',
            link: null,
            body: 'Come.',
            entries: [anEntry({ id: 't-1', body: 'noted', kind: 'comment' })],
          }),
        ],
      ),
    )

    expect(
      await screen.findByRole('button', { name: notificationCategoryInfo.post_comment_any.label }),
    ).toBeTruthy()
  })

  it('offers the switch that belongs to the card, not the dream one of the same name', async () => {
    renderPage(
      stub(
        {},
        [],
        [
          aCard({
            id: 'c-1',
            title: 'Ada',
            entity_type: 'attendance',
            link: '/members/a-1',
            entries: [anEntry({ id: 't-1', body: 'nice one', kind: 'comment' })],
          }),
        ],
      ),
    )

    expect(
      await screen.findByRole('button', { name: notificationCategoryInfo.introduction_comment_any.label }),
    ).toBeTruthy()
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
    expect(document.querySelectorAll('.feed-card .chip')).toHaveLength(1)
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

  it('says the songbook where a card belongs to no burn', async () => {
    renderPage(
      stub(
        {},
        [],
        [aCard({ id: 'c-1', title: 'Fire in the sky', entity_type: 'song', event_id: null, burn: null })],
      ),
    )

    await screen.findByText('Fire in the sky')
    expect(document.querySelector('.feed-when')?.textContent).toBe('Songbook · 7 Aug')
  })

  it('offers no rewording on a song card, which is edited on its own page', async () => {
    renderPage(
      stub(
        {},
        [],
        [
          aCard({
            id: 'c-1',
            title: 'Fire in the sky',
            entity_type: 'song',
            event_id: null,
            burn: null,
            own: true,
          }),
        ],
      ),
    )

    await screen.findByText('Fire in the sky')
    expect(screen.queryByRole('button', { name: 'Reword it' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Take back/ })).toBeNull()
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

  it('is a column, so the cards do not run the width of the window', () => {
    const { container } = renderPage(stub())

    expect(container.querySelector('section')?.className).toBe('page column')
  })
})
