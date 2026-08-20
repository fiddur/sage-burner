import type { MyBurn, Place, Session } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { LocationProvider } from 'preact-iso'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { DreamsApi } from './Dreams.tsx'

import { apiError } from '../api/client.ts'
import { BurnProvider } from '../burn.tsx'
import { onADesktop, onAPhone } from '../testing/viewport.ts'
import { ViewerProvider } from '../viewer.tsx'
import { Dreams } from './Dreams.tsx'

afterEach(cleanup)

const MEMBER: Viewer = {
  status: 'signed-in',
  account: { id: 'a-1', name: null, avatar: null, roles: ['member'] },
}

const BURN = {
  id: 'e-1',
  name: 'Summer burn',
  slug: 'summer-burn',
  start_date: '2026-08-01',
  end_date: '2026-08-05',
  start_time: '16:00',
  end_time: '12:00',
  welcome_markdown: '',
  payment_info_markdown: '',
  transfer_info_markdown: '',
  member_cap: 42,
  created_at: '2026-07-02T00:00:00.000Z',
}

const TEMPLE: Place = { id: 'p-1', event_id: 'e-1', order: 0, name: 'Temple', emoji: '🛕', color: 'yellow' }

const aDream = (over: Partial<Session> & Pick<Session, 'id' | 'title'>): Session => ({
  event_id: 'e-1',
  facilitator_account_id: 'a-1',
  description: '',
  repeatable: false,
  time_slot_start: null,
  time_slot_end: null,
  place_id: null,
  helpers: [],
  supporters: [],
  support_count: 0,
  supported_by_me: false,
  thread_id: null,
  ...over,
})

const stub = (over: Partial<DreamsApi> = {}, sessions: Session[] = []): DreamsApi => ({
  getSessions: () => Promise.resolve({ sessions }),
  getPlaces: () => Promise.resolve({ places: [TEMPLE] }),
  offerSession: () => Promise.reject(new Error('offerSession is not stubbed here')),
  uploadImage: () => Promise.reject(new Error('uploadImage is not stubbed here')),
  updateSession: () => Promise.reject(new Error('updateSession is not stubbed here')),
  getThread: () => Promise.reject(new Error('getThread is not stubbed here')),
  postComment: () => Promise.reject(new Error('postComment is not stubbed here')),
  updateComment: () => Promise.reject(new Error('updateComment is not stubbed here')),
  deleteComment: () => Promise.reject(new Error('deleteComment is not stubbed here')),
  supportComment: () => Promise.reject(new Error('supportComment is not stubbed here')),
  withdrawSupportForComment: () => Promise.reject(new Error('withdrawSupportForComment is not stubbed here')),
  withdrawSession: () => Promise.reject(new Error('withdrawSession is not stubbed here')),
  getEventAttendees: () =>
    Promise.resolve({
      attendees: [
        { account_id: 'a-1', name: 'Ada', avatar: null },
        { account_id: 'a-2', name: 'Bea', avatar: null },
      ],
    }),
  helpWithSession: () => Promise.reject(new Error('helpWithSession is not stubbed here')),
  stopHelpingWithSession: () => Promise.reject(new Error('stopHelpingWithSession is not stubbed here')),
  supportSession: () => Promise.reject(new Error('supportSession is not stubbed here')),
  withdrawSupportForSession: () => Promise.reject(new Error('withdrawSupportForSession is not stubbed here')),
  ...over,
})

const CHOSEN: MyBurn = { event: BURN, attendance: null }

const renderPage = (api: DreamsApi, viewer: Viewer = MEMBER, burn: MyBurn | null = CHOSEN) => {
  history.replaceState(null, '', '/dreams')

  return render(
    <LocationProvider>
      <ViewerProvider viewer={viewer}>
        <BurnProvider
          value={{ status: 'ready', burns: burn === null ? [] : [burn], selected: burn ?? undefined }}
        >
          <Dreams api={api} />
        </BurnProvider>
      </ViewerProvider>
    </LocationProvider>,
  )
}

const renderPageAt = (at: string, api: DreamsApi) => {
  history.replaceState(null, '', at)

  return render(
    <LocationProvider>
      <ViewerProvider viewer={MEMBER}>
        <BurnProvider value={{ status: 'ready', burns: [CHOSEN], selected: CHOSEN }}>
          <Dreams api={api} />
        </BurnProvider>
      </ViewerProvider>
    </LocationProvider>,
  )
}

const openDream = async (title: string) => {
  fireEvent.click(await screen.findByRole('button', { name: `Open ${title}` }))
}

const openEditor = async (title: string) => {
  await openDream(title)
  fireEvent.click(await screen.findByRole('button', { name: `Edit ${title}` }))
}

describe('Dreams', () => {
  it('says so when nobody has offered one', async () => {
    renderPage(stub())

    expect(await screen.findByText(/Nobody has offered a dream yet/)).toBeTruthy()
  })

  it('shows an unscheduled dream as unscheduled rather than blank', async () => {
    renderPage(stub({}, [aDream({ id: 's-1', title: 'Sunrise yoga' })]))

    expect(await screen.findByText('Sunrise yoga')).toBeTruthy()
    expect(screen.getByText('not scheduled yet')).toBeTruthy()
  })

  it('shows a scheduled dream with its place', async () => {
    renderPage(
      stub({}, [
        aDream({
          id: 's-1',
          title: 'Cacao ceremony',
          place_id: 'p-1',
          time_slot_start: '2026-08-02T18:00:00.000Z',
          time_slot_end: '2026-08-02T20:00:00.000Z',
        }),
      ]),
    )

    expect(await screen.findByText('🛕 Temple')).toBeTruthy()
    expect(screen.queryByText('not scheduled yet')).toBeNull()
  })

  it('offers one with just a name', async () => {
    const offerSession = vi.fn<DreamsApi['offerSession']>(() =>
      Promise.resolve({ session: aDream({ id: 's-2', title: 'Sunrise yoga' }) }),
    )
    renderPage(stub({ offerSession }))

    fireEvent.input(await screen.findByRole('textbox', { name: 'What is it?' }), {
      target: { value: '  Sunrise yoga  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Offer it' }))

    await waitFor(() =>
      expect(offerSession).toHaveBeenCalledWith('e-1', { title: 'Sunrise yoga', description: '' }),
    )
  })

  it('refuses a nameless dream here rather than letting the server say no', async () => {
    const offerSession = vi.fn<DreamsApi['offerSession']>(() =>
      Promise.resolve({ session: aDream({ id: 's-2', title: 'x' }) }),
    )
    renderPage(stub({ offerSession }))

    fireEvent.click(await screen.findByRole('button', { name: 'Offer it' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Give your dream a name')
    expect(offerSession).not.toHaveBeenCalled()
  })

  it('schedules one into a place and a slot, sending UTC', async () => {
    const updateSession = vi.fn<DreamsApi['updateSession']>(() =>
      Promise.resolve({ session: aDream({ id: 's-1', title: 'Sunrise yoga' }) }),
    )
    renderPage(stub({ updateSession }, [aDream({ id: 's-1', title: 'Sunrise yoga' })]))

    await openEditor('Sunrise yoga')
    fireEvent.change(screen.getByRole('combobox', { name: 'Place for Sunrise yoga' }), {
      target: { value: 'p-1' },
    })
    fireEvent.input(screen.getByLabelText('Start of Sunrise yoga'), {
      target: { value: '2026-08-02T20:00' },
    })
    fireEvent.input(screen.getByLabelText('End of Sunrise yoga'), {
      target: { value: '2026-08-02T22:00' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updateSession).toHaveBeenCalledWith('s-1', {
        place_id: 'p-1',
        time_slot_start: '2026-08-02T18:00:00.000Z',
        time_slot_end: '2026-08-02T20:00:00.000Z',
      }),
    )
  })

  it('shows a stored slot back in local time, not UTC', async () => {
    renderPage(
      stub({}, [
        aDream({
          id: 's-1',
          title: 'Cacao ceremony',
          time_slot_start: '2026-08-02T18:00:00.000Z',
          time_slot_end: '2026-08-02T20:00:00.000Z',
        }),
      ]),
    )

    await openEditor('Cacao ceremony')

    expect(screen.getByLabelText('Start of Cacao ceremony')).toHaveProperty('value', '2026-08-02T20:00')
  })

  it('unschedules by choosing nowhere and clearing both ends', async () => {
    const updateSession = vi.fn<DreamsApi['updateSession']>(() =>
      Promise.resolve({ session: aDream({ id: 's-1', title: 'Cacao ceremony' }) }),
    )
    renderPage(
      stub({ updateSession }, [
        aDream({
          id: 's-1',
          title: 'Cacao ceremony',
          place_id: 'p-1',
          time_slot_start: '2026-08-02T18:00:00.000Z',
          time_slot_end: '2026-08-02T20:00:00.000Z',
        }),
      ]),
    )

    await openEditor('Cacao ceremony')
    fireEvent.change(screen.getByRole('combobox', { name: 'Place for Cacao ceremony' }), {
      target: { value: '' },
    })
    fireEvent.input(screen.getByLabelText('Start of Cacao ceremony'), { target: { value: '' } })
    fireEvent.input(screen.getByLabelText('End of Cacao ceremony'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updateSession).toHaveBeenCalledWith('s-1', {
        place_id: null,
        time_slot_start: null,
        time_slot_end: null,
      }),
    )
  })

  it('sends only what this form changed, so a title fix cannot unschedule a dream', async () => {
    const updateSession = vi.fn<DreamsApi['updateSession']>(() =>
      Promise.resolve({ session: aDream({ id: 's-1', title: 'Renamed' }) }),
    )
    renderPage(
      stub({ updateSession }, [
        aDream({
          id: 's-1',
          title: 'Cacao ceremony',
          place_id: 'p-1',
          time_slot_start: '2026-08-02T18:00:00.000Z',
          time_slot_end: '2026-08-02T20:00:00.000Z',
        }),
      ]),
    )

    await openEditor('Cacao ceremony')
    fireEvent.input(screen.getByLabelText('Title of Cacao ceremony'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateSession).toHaveBeenCalledWith('s-1', { title: 'Renamed' }))
  })

  it('leaves a slot carrying seconds alone when only the title was touched', async () => {
    const updateSession = vi.fn<DreamsApi['updateSession']>(() =>
      Promise.resolve({ session: aDream({ id: 's-1', title: 'Renamed' }) }),
    )
    renderPage(
      stub({ updateSession }, [
        aDream({
          id: 's-1',
          title: 'Cacao ceremony',
          time_slot_start: '2026-08-02T18:00:30.000Z',
          time_slot_end: '2026-08-02T20:00:45.000Z',
        }),
      ]),
    )

    await openEditor('Cacao ceremony')
    fireEvent.input(screen.getByLabelText('Title of Cacao ceremony'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateSession).toHaveBeenCalledWith('s-1', { title: 'Renamed' }))
  })

  it('sends nothing at all when the form was opened and closed unchanged', async () => {
    const updateSession = vi.fn<DreamsApi['updateSession']>(() =>
      Promise.resolve({ session: aDream({ id: 's-1', title: 'Cacao ceremony' }) }),
    )
    renderPage(stub({ updateSession }, [aDream({ id: 's-1', title: 'Cacao ceremony', place_id: 'p-1' })]))

    await openEditor('Cacao ceremony')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateSession).toHaveBeenCalledWith('s-1', {}))
  })

  it('binds the two ends of the slot to each other', async () => {
    renderPage(
      stub({}, [
        aDream({
          id: 's-1',
          title: 'Cacao ceremony',
          time_slot_start: '2026-08-02T18:00:00.000Z',
          time_slot_end: '2026-08-02T20:00:00.000Z',
        }),
      ]),
    )

    await openEditor('Cacao ceremony')

    expect(screen.getByLabelText('Start of Cacao ceremony').getAttribute('max')).toBe('2026-08-02T22:00')
    expect(screen.getByLabelText('End of Cacao ceremony').getAttribute('min')).toBe('2026-08-02T20:00')
  })

  it('marks a dream as one that can be planned more than once', async () => {
    const updateSession = vi.fn<DreamsApi['updateSession']>(() =>
      Promise.resolve({ session: aDream({ id: 's-1', title: 'Check in', repeatable: true }) }),
    )
    renderPage(stub({ updateSession }, [aDream({ id: 's-1', title: 'Check in' })]))

    await openEditor('Check in')
    fireEvent.click(screen.getByLabelText('Plan Check in more than once'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateSession).toHaveBeenCalledWith('s-1', { repeatable: true }))
  })

  it('leaves the flag out of an edit that did not touch it', async () => {
    const updateSession = vi.fn<DreamsApi['updateSession']>(() =>
      Promise.resolve({ session: aDream({ id: 's-1', title: 'Renamed', repeatable: true }) }),
    )
    renderPage(stub({ updateSession }, [aDream({ id: 's-1', title: 'Check in', repeatable: true })]))

    await openEditor('Check in')
    fireEvent.input(screen.getByLabelText('Title of Check in'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateSession).toHaveBeenCalledWith('s-1', { title: 'Renamed' }))
  })

  it('shows the ↻ on the row, so the list says which ones repeat', async () => {
    renderPage(
      stub({}, [
        aDream({ id: 's-1', title: 'Check in', repeatable: true }),
        aDream({ id: 's-2', title: 'Sunrise yoga' }),
      ]),
    )

    const marked = [...(await screen.findAllByRole('listitem'))].filter(
      (row) => row.querySelector('[data-icon="repeats"]') !== null,
    )

    expect(marked).toHaveLength(1)
    expect(marked[0]?.textContent).toContain('Check in')
  })

  it('names a facilitator who has since withdrawn, rather than reading as nobody', async () => {
    renderPage(stub({}, [aDream({ id: 's-1', title: 'Cacao ceremony', facilitator_account_id: 'a-9' })]))

    await openEditor('Cacao ceremony')
    const select = screen.getByLabelText('Facilitator for Cacao ceremony')

    expect(select).toHaveProperty('value', 'a-9')
    expect(select.textContent).toContain('Somebody who is no longer coming')
  })

  it('offers no such option when the facilitator is coming', async () => {
    renderPage(stub({}, [aDream({ id: 's-1', title: 'Cacao ceremony', facilitator_account_id: 'a-2' })]))

    await openEditor('Cacao ceremony')

    expect(screen.getByLabelText('Facilitator for Cacao ceremony').textContent).not.toContain(
      'no longer coming',
    )
  })

  it('withdraws one, but only after asking — as the grid’s panel does', async () => {
    const withdrawSession = vi.fn<DreamsApi['withdrawSession']>(() => Promise.resolve(undefined))
    renderPage(stub({ withdrawSession }, [aDream({ id: 's-1', title: 'Sunrise yoga' })]))

    await openDream('Sunrise yoga')
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw Sunrise yoga' }))
    expect(withdrawSession).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Really withdraw Sunrise yoga' }))

    await waitFor(() => expect(withdrawSession).toHaveBeenCalledWith('s-1'))
  })

  it('keeps it when the question is answered the other way', async () => {
    const withdrawSession = vi.fn<DreamsApi['withdrawSession']>(() => Promise.resolve(undefined))
    renderPage(stub({ withdrawSession }, [aDream({ id: 's-1', title: 'Sunrise yoga' })]))

    await openDream('Sunrise yoga')
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw Sunrise yoga' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }))

    expect(withdrawSession).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Withdraw Sunrise yoga' })).toBeTruthy()
  })

  it('asks about the dream that was opened, not about the one beside it', async () => {
    renderPage(
      stub({}, [
        aDream({ id: 's-1', title: 'Sunrise yoga' }),
        aDream({ id: 's-2', title: 'Cacao ceremony' }),
      ]),
    )

    await openDream('Sunrise yoga')
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw Sunrise yoga' }))

    expect(screen.getByRole('button', { name: 'Really withdraw Sunrise yoga' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Really withdraw Cacao ceremony' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Withdraw Cacao ceremony' })).toBeNull()
  })

  it('lets a member edit a dream someone else offered', async () => {
    renderPage(stub({}, [aDream({ id: 's-1', title: 'Theirs', facilitator_account_id: 'a-9' })]))

    await openDream('Theirs')

    expect(await screen.findByRole('button', { name: 'Edit Theirs' })).toBeTruthy()
  })

  it('opens the panel the grid opens, with what the row never showed', async () => {
    renderPage(
      stub({}, [
        aDream({
          id: 's-1',
          title: 'Cacao ceremony',
          description: 'Bring a cup you like.',
          facilitator_account_id: 'a-2',
        }),
      ]),
    )

    await openDream('Cacao ceremony')

    expect(await screen.findByText('Bring a cup you like.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Facilitating' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Helping out' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Show support' })).toBeTruthy()
  })

  it('carries no pen and no bin on the row itself', async () => {
    renderPage(stub({}, [aDream({ id: 's-1', title: 'Sunrise yoga' })]))

    await screen.findByRole('button', { name: 'Open Sunrise yoga' })

    expect(screen.queryByRole('button', { name: 'Edit Sunrise yoga' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Withdraw Sunrise yoga' })).toBeNull()
  })

  it('shows support from the list, which the row could not', async () => {
    const supportSession = vi.fn<DreamsApi['supportSession']>(() =>
      Promise.resolve({ session: aDream({ id: 's-1', title: 'Sunrise yoga', supported_by_me: true }) }),
    )
    renderPage(stub({ supportSession }, [aDream({ id: 's-1', title: 'Sunrise yoga' })]))

    await openDream('Sunrise yoga')
    fireEvent.click(await screen.findByRole('button', { name: 'Show support' }))

    await waitFor(() => expect(supportSession).toHaveBeenCalledWith('s-1'))
  })

  it('shows what the server said when a write is refused', async () => {
    renderPage(
      stub({ withdrawSession: () => Promise.reject(apiError(400, 'bad_request', 'That will not do.')) }, [
        aDream({ id: 's-1', title: 'Sunrise yoga' }),
      ]),
    )

    await openDream('Sunrise yoga')
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw Sunrise yoga' }))
    fireEvent.click(screen.getByRole('button', { name: 'Really withdraw Sunrise yoga' }))

    expect((await screen.findByRole('alert')).textContent).toContain('That will not do.')
  })

  it('surfaces a failure to load', async () => {
    renderPage(stub({ getSessions: () => Promise.reject(new Error('nope')) }))

    expect((await screen.findByRole('alert')).textContent).toContain('Could not load')
  })

  it('does not fetch for someone who is neither a member nor an admin', async () => {
    const getSessions = vi.fn<DreamsApi['getSessions']>(() => Promise.resolve({ sessions: [] }))
    renderPage(stub({ getSessions }), { status: 'signed-out' })

    expect(screen.getByText(/for members/)).toBeTruthy()
    expect(getSessions).not.toHaveBeenCalled()
  })

  it('opens to an organiser who holds admin alone', async () => {
    const organiser: Viewer = {
      status: 'signed-in',
      account: { id: 'a-9', name: null, avatar: null, roles: ['admin'] },
    }
    renderPage(stub({}, [aDream({ id: 's-1', title: 'Opening circle' })]), organiser)

    expect(await screen.findByRole('button', { name: 'Open Opening circle' })).toBeTruthy()
  })

  it('opens the dream a link names, and shows what has been said about it', async () => {
    const thread = vi.fn<DreamsApi['getThread']>(() =>
      Promise.resolve({
        thread: {
          id: 'th-1',
          event_id: 'e-1',
          burn: 'Summer burn',
          entity_type: 'session',
          entity_id: 's-1',
          title: 'Sunrise yoga',
          link: '/dreams?burn=e-1&dream=s-1',
          body: null,
          own: false,
          gone: false,
          entry_count: 1,
          supporters: [],
          support_count: 0,
          supported_by_me: false,
          followed_by_me: false,
          last_at: '2026-08-07T18:00:00.000Z',
          entries: [
            {
              id: 't-1',
              kind: 'comment',
              author: { account_id: 'a-2', name: 'Bea' },
              body: 'is one mat enough?',
              created_at: '2026-08-07T18:00:00.000Z',
              edited_at: null,
              supporters: [],
              support_count: 0,
              supported_by_me: false,
            },
          ],
        },
      }),
    )

    renderPageAt(
      '/dreams?dream=s-1',
      stub({ getThread: thread }, [aDream({ id: 's-1', title: 'Sunrise yoga', thread_id: 'th-1' })]),
    )

    expect(await screen.findByRole('dialog', { name: 'Sunrise yoga' })).toBeTruthy()
    await waitFor(() => expect(thread).toHaveBeenCalledWith('th-1', expect.anything()))
    expect(await screen.findByText('is one mat enough?')).toBeTruthy()
  })

  it('opens nothing for a dream this burn does not have', async () => {
    renderPageAt('/dreams?dream=gone', stub({}, [aDream({ id: 's-1', title: 'Sunrise yoga' })]))

    await screen.findByText('Sunrise yoga')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('an opened dream on a phone, which is a page rather than something over one', () => {
  afterEach(onADesktop)

  it('is a region and not a dialog, there being nothing modal about a page', async () => {
    onAPhone()
    renderPage(stub({}, [aDream({ id: 's-1', title: 'Sunrise yoga' })]))

    await openDream('Sunrise yoga')

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('region', { name: 'Sunrise yoga' })).toBeTruthy()
  })

  it('takes the list off the page rather than sitting over it', async () => {
    onAPhone()
    renderPage(stub({}, [aDream({ id: 's-1', title: 'Sunrise yoga' })]))

    await openDream('Sunrise yoga')

    expect(screen.queryByRole('button', { name: 'Open Sunrise yoga' })).toBeNull()
  })

  it('keeps the list when the asked dream is not among them, rather than emptying the page', async () => {
    onAPhone()
    renderPageAt('/dreams?dream=gone', stub({}, [aDream({ id: 's-1', title: 'Sunrise yoga' })]))

    expect(await screen.findByRole('button', { name: 'Open Sunrise yoga' })).toBeTruthy()
  })

  it('keeps the list up while the dreams are still loading, so nothing blinks empty', async () => {
    onAPhone()
    renderPageAt('/dreams?dream=s-1', stub({}, [aDream({ id: 's-1', title: 'Sunrise yoga' })]))

    expect(screen.getByText('Loading…')).toBeTruthy()
  })

  it('arrives at the top of the window, the way following a link to a page does', async () => {
    onAPhone()
    renderPage(stub({}, [aDream({ id: 's-1', title: 'Sunrise yoga' })]))
    await screen.findByRole('button', { name: 'Open Sunrise yoga' })
    globalThis.scrollTo(0, 745)
    expect(globalThis.scrollY, 'a list that never scrolled would pass this without a fix').toBe(745)

    await openDream('Sunrise yoga')

    await waitFor(() => {
      expect(globalThis.scrollY).toBe(0)
    })
  })

  it('takes no focus, so a cold arrival draws no ring around the whole page', async () => {
    onAPhone()
    renderPageAt('/dreams?dream=s-1', stub({}, [aDream({ id: 's-1', title: 'Sunrise yoga' })]))

    await screen.findByRole('region', { name: 'Sunrise yoga' })

    expect(document.activeElement).not.toBe(screen.getByRole('region', { name: 'Sunrise yoga' }))
  })

  it('keeps the page\u2019s own heading, so the document does not start at h2', async () => {
    onAPhone()
    renderPage(stub({}, [aDream({ id: 's-1', title: 'Sunrise yoga' })]))

    await openDream('Sunrise yoga')

    expect(screen.getByRole('heading', { name: /Dreams/, level: 1 })).toBeTruthy()
  })

  it('stays a dialog above the breakpoint, the grid behind it being the context there', async () => {
    onADesktop()
    renderPage(stub({}, [aDream({ id: 's-1', title: 'Sunrise yoga' })]))

    await openDream('Sunrise yoga')

    expect(screen.getByRole('dialog', { name: 'Sunrise yoga' })).toBeTruthy()
  })
})

describe('which dream is open lives in the query, so Back closes it', () => {
  it('names the opened dream in the URL', async () => {
    renderPage(stub({}, [aDream({ id: 's-1', title: 'Sunrise yoga' })]))

    await openDream('Sunrise yoga')

    expect(new URL(window.location.href).searchParams.get('dream')).toBe('s-1')
  })

  it('takes it off again on closing', async () => {
    renderPage(stub({}, [aDream({ id: 's-1', title: 'Sunrise yoga' })]))

    await openDream('Sunrise yoga')
    fireEvent.click(screen.getByRole('button', { name: 'Close Sunrise yoga' }))

    await waitFor(() => {
      expect(new URL(window.location.href).searchParams.get('dream')).toBeNull()
    })
  })

  it('closes the panel when the query loses the dream, which is what Back does', async () => {
    renderPageAt('/dreams?dream=s-1', stub({}, [aDream({ id: 's-1', title: 'Sunrise yoga' })]))

    expect(await screen.findByRole('heading', { name: 'Sunrise yoga', level: 2 })).toBeTruthy()

    history.replaceState(null, '', '/dreams')
    globalThis.dispatchEvent(new PopStateEvent('popstate'))

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Sunrise yoga', level: 2 })).toBeNull()
    })
  })
})
