import type { Meeting, MeetingPointEntry } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { MeetingsApi } from './Meetings.tsx'

import { BurnProvider } from '../burn.tsx'
import { ViewerProvider } from '../viewer.tsx'
import { Meetings, whenItIs } from './Meetings.tsx'

afterEach(cleanup)

const MEMBER: Viewer = {
  status: 'signed-in',
  account: { id: 'a-1', name: 'Ada', avatar: null, roles: ['member'] },
}

const BURN = {
  id: 'e-1',
  name: 'Summer burn',
  slug: 'summer-burn',
  start_date: '2026-08-01',
  end_date: '2026-08-03',
  start_time: '16:00',
  end_time: '12:00',
  location: '',
  welcome_markdown: '',
  payment_info_markdown: '',
  transfer_info_markdown: '',
  member_cap: 42,
  created_at: '2026-07-02T00:00:00.000Z',
}

const aPoint = (over: Partial<MeetingPointEntry> = {}): MeetingPointEntry => ({
  id: 'p-1',
  event_id: 'e-1',
  author_account_id: 'a-1',
  author_name: 'Ada',
  title: 'Where do we park?',
  body: '',
  decision: null,
  decided_note: null,
  created_at: '2026-07-02T00:00:00.000Z',
  thread_id: 't-1',
  ...over,
})

const aMeeting = (over: Partial<Meeting> = {}): Meeting => ({
  id: 'm-1',
  event_id: 'e-1',
  author_account_id: 'a-1',
  title: 'Planning call',
  starts_at: '2099-07-20T17:00:00.000Z',
  ends_at: null,
  link: null,
  notes: '',
  created_at: '2026-07-02T00:00:00.000Z',
  ...over,
})

const stub = (over: Partial<MeetingsApi> = {}): MeetingsApi => ({
  getMeetingPoints: () => Promise.resolve({ points: [] }),
  addMeetingPoint: () => Promise.reject(new Error('addMeetingPoint is not stubbed here')),
  updateMeetingPoint: () => Promise.reject(new Error('updateMeetingPoint is not stubbed here')),
  deleteMeetingPoint: () => Promise.reject(new Error('deleteMeetingPoint is not stubbed here')),
  decidePoint: () => Promise.reject(new Error('decidePoint is not stubbed here')),
  getMeetings: () => Promise.resolve({ meetings: [] }),
  addMeeting: () => Promise.reject(new Error('addMeeting is not stubbed here')),
  updateMeeting: () => Promise.reject(new Error('updateMeeting is not stubbed here')),
  deleteMeeting: () => Promise.reject(new Error('deleteMeeting is not stubbed here')),
  getEventAttendees: () => Promise.resolve({ attendees: [] }),
  getThread: () => Promise.reject(new Error('getThread is not stubbed here')),
  postComment: () => Promise.reject(new Error('postComment is not stubbed here')),
  updateComment: () => Promise.reject(new Error('updateComment is not stubbed here')),
  deleteComment: () => Promise.reject(new Error('deleteComment is not stubbed here')),
  supportComment: () => Promise.reject(new Error('supportComment is not stubbed here')),
  withdrawSupportForComment: () => Promise.reject(new Error('withdrawSupportForComment is not stubbed here')),
  uploadImage: () => Promise.reject(new Error('uploadImage is not stubbed here')),
  ...over,
})

const MINE = { event: BURN, attendance: null }

const renderPage = (api: MeetingsApi) =>
  render(
    <ViewerProvider viewer={MEMBER}>
      <BurnProvider value={{ status: 'ready', burns: [MINE], selected: MINE }}>
        <Meetings api={api} />
      </BurnProvider>
    </ViewerProvider>,
  )

describe('the meetings page', () => {
  it('splits the points into what is open and what has been addressed', async () => {
    renderPage(
      stub({
        getMeetingPoints: () =>
          Promise.resolve({
            points: [
              aPoint({ id: 'p-1', title: 'Where do we park?' }),
              aPoint({ id: 'p-2', title: 'Who cooks Friday?', decision: 'Bo does' }),
            ],
          }),
      }),
    )

    expect(await screen.findByText('Where do we park?')).toBeTruthy()
    expect(screen.getByText('Bo does')).toBeTruthy()
  })

  it('says when the next meeting is, with the link to join on', async () => {
    renderPage(
      stub({
        getMeetings: () => Promise.resolve({ meetings: [aMeeting({ link: 'https://meet.example/abc' })] }),
      }),
    )

    expect(await screen.findByText('Planning call')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Join' }).getAttribute('href')).toBe('https://meet.example/abc')
  })

  it('says the diary is empty rather than showing a meeting that has been and gone', async () => {
    renderPage(
      stub({
        getMeetings: () =>
          Promise.resolve({ meetings: [aMeeting({ starts_at: '2020-01-01T10:00:00.000Z' })] }),
      }),
    )

    expect(
      await screen.findByText(
        'Nothing in the diary. Put the next one in under “Put a meeting in the diary”.',
      ),
    ).toBeTruthy()
  })

  it('asks before taking a meeting out of the diary, there being no undo', async () => {
    const deleteMeeting = vi.fn<MeetingsApi['deleteMeeting']>(() => Promise.resolve(undefined))
    renderPage(stub({ getMeetings: () => Promise.resolve({ meetings: [aMeeting()] }), deleteMeeting }))

    fireEvent.click(await screen.findByRole('button', { name: /^Take out of the diary Planning call, /u }))

    expect(screen.getByText(/^Take out of the diary Planning call, .*\?$/u)).toBeTruthy()
    expect(deleteMeeting).not.toHaveBeenCalled()
  })

  it('takes it out once that is answered', async () => {
    const deleteMeeting = vi.fn<MeetingsApi['deleteMeeting']>(() => Promise.resolve(undefined))
    renderPage(stub({ getMeetings: () => Promise.resolve({ meetings: [aMeeting()] }), deleteMeeting }))

    fireEvent.click(await screen.findByRole('button', { name: /^Take out of the diary Planning call, /u }))
    fireEvent.click(screen.getByRole('button', { name: /^Really take out of the diary Planning call, /u }))

    await waitFor(() => expect(deleteMeeting).toHaveBeenCalledWith('m-1'))
  })

  it('asks before taking a point off, whose thread goes with it', async () => {
    const deleteMeetingPoint = vi.fn<MeetingsApi['deleteMeetingPoint']>(() => Promise.resolve(undefined))
    renderPage(stub({ getMeetingPoints: () => Promise.resolve({ points: [aPoint()] }), deleteMeetingPoint }))

    fireEvent.click(await screen.findByRole('button', { name: 'Take off Where do we park?' }))

    expect(screen.getByText(/Take off Where do we park\?/u)).toBeTruthy()
    expect(deleteMeetingPoint).not.toHaveBeenCalled()
  })

  it('puts a new meeting in the diary from outside the box of the one already there', async () => {
    const { container } = renderPage(stub({ getMeetings: () => Promise.resolve({ meetings: [aMeeting()] }) }))

    const adding = await screen.findByRole('button', { name: 'Put a meeting in the diary' })

    expect(container.querySelector('.next-meeting')?.contains(adding)).toBe(false)
  })

  it('changes the meeting in the diary from the banner it is shown in', async () => {
    const updateMeeting = vi.fn<MeetingsApi['updateMeeting']>(() => Promise.resolve({ meeting: aMeeting() }))
    renderPage(stub({ getMeetings: () => Promise.resolve({ meetings: [aMeeting()] }), updateMeeting }))

    fireEvent.click(await screen.findByRole('button', { name: /^Edit Planning call, /u }))
    fireEvent.input(screen.getByLabelText('What the meeting is'), {
      target: { value: 'Planning call, moved' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updateMeeting).toHaveBeenCalledWith('m-1', {
        title: 'Planning call, moved',
        starts_at: '2099-07-20T17:00:00.000Z',
        ends_at: null,
        link: null,
        notes: '',
      }),
    )
  })

  it('starts that form from what the meeting already says', async () => {
    renderPage(
      stub({
        getMeetings: () => Promise.resolve({ meetings: [aMeeting({ link: 'https://meet.example/abc' })] }),
      }),
    )

    fireEvent.click(await screen.findByRole('button', { name: /^Edit Planning call, /u }))

    expect(screen.getByLabelText('A link to join the meeting on')).toHaveProperty(
      'value',
      'https://meet.example/abc',
    )
  })

  it('takes the notes in the same editor as everything else, with a preview', async () => {
    renderPage(stub({ getMeetings: () => Promise.resolve({ meetings: [aMeeting()] }) }))

    fireEvent.click(await screen.findByRole('button', { name: /^Edit Planning call, /u }))
    const box = screen.getByLabelText('Anything else about the meeting')
    fireEvent.input(box, { target: { value: '- the door code is 1234' } })

    const field = within(box.closest('.field') as HTMLElement)
    fireEvent.click(field.getByRole('tab', { name: 'Preview' }))

    expect(field.getByRole('listitem').textContent).toBe('the door code is 1234')
  })

  it('refuses to save while a picture in the notes is still going up', async () => {
    renderPage(stub({ getMeetings: () => Promise.resolve({ meetings: [aMeeting()] }) }))

    fireEvent.click(await screen.findByRole('button', { name: /^Edit Planning call, /u }))
    fireEvent.input(screen.getByLabelText('Anything else about the meeting'), {
      target: { value: '![Uploading room.jpg…]()' },
    })

    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true)
  })

  it('tells two meetings of the same name apart, on the ✏️ as well as the bin', async () => {
    renderPage(
      stub({
        getMeetings: () =>
          Promise.resolve({
            meetings: [
              aMeeting(),
              aMeeting({ id: 'm-2', starts_at: '2099-08-25T17:00:00.000Z' }),
              aMeeting({ id: 'm-3', starts_at: '2099-08-26T17:00:00.000Z' }),
            ],
          }),
      }),
    )

    await screen.findAllByText('Planning call')

    const named = (kind: RegExp) =>
      screen.getAllByRole('button', { name: kind }).map((one) => one.getAttribute('aria-label') ?? '')

    // Each one carries the time, not merely a set of three distinct strings: leaving the
    // banner's controls on the bare title keeps the set distinct and says nothing.
    for (const kind of [/^Edit Planning call/u, /^Take out of the diary Planning call/u]) {
      const labels = named(kind)

      expect(labels).toHaveLength(3)
      for (const one of labels) expect(one).toMatch(/Planning call, \w/u)
    }
  })

  it('changes one further down the diary too, not only the next one', async () => {
    // #587: `MeetingFields` rendered from `NextMeeting` alone, so mistyping the time on
    // anything but the imminent meeting left 🗑️ and scheduling it again as the way back —
    // which re-tells everybody and drops the old UID out of every subscribed calendar.
    const updateMeeting = vi.fn<MeetingsApi['updateMeeting']>(() => Promise.resolve({ meeting: aMeeting() }))
    renderPage(
      stub({
        getMeetings: () =>
          Promise.resolve({
            meetings: [
              aMeeting(),
              aMeeting({ id: 'm-2', title: 'Toves meeting', starts_at: '2099-08-25T17:00:00.000Z' }),
            ],
          }),
        updateMeeting,
      }),
    )

    fireEvent.click(await screen.findByRole('button', { name: /^Edit Toves meeting, /u }))
    fireEvent.input(screen.getByLabelText('What the meeting is'), {
      target: { value: 'Toves meeting, moved' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updateMeeting).toHaveBeenCalledWith('m-2', {
        title: 'Toves meeting, moved',
        starts_at: '2099-08-25T17:00:00.000Z',
        ends_at: null,
        link: null,
        notes: '',
      }),
    )
  })

  it('opens one form at a time, so two rows cannot disagree about what is being changed', async () => {
    renderPage(
      stub({
        getMeetings: () =>
          Promise.resolve({
            meetings: [
              aMeeting(),
              aMeeting({ id: 'm-2', title: 'Toves meeting', starts_at: '2099-08-25T17:00:00.000Z' }),
              aMeeting({ id: 'm-3', title: 'Long build sync', starts_at: '2099-08-26T17:00:00.000Z' }),
            ],
          }),
      }),
    )

    fireEvent.click(await screen.findByRole('button', { name: /^Edit Toves meeting, /u }))
    expect(screen.getAllByLabelText('What the meeting is')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: /^Edit Long build sync, /u }))

    const open = screen.getAllByLabelText('What the meeting is')
    expect(open).toHaveLength(1)
    expect(open[0]).toHaveProperty('value', 'Long build sync')
  })

  it('shuts the form again when the same ✏️ is pressed twice', async () => {
    renderPage(
      stub({
        getMeetings: () =>
          Promise.resolve({
            meetings: [
              aMeeting(),
              aMeeting({ id: 'm-2', title: 'Toves meeting', starts_at: '2099-08-25T17:00:00.000Z' }),
            ],
          }),
      }),
    )

    fireEvent.click(await screen.findByRole('button', { name: /^Edit Toves meeting, /u }))
    fireEvent.click(screen.getByRole('button', { name: /^Edit Toves meeting, /u }))

    expect(screen.queryByLabelText('What the meeting is')).toBeNull()
  })

  it('keeps a meeting that has been out of the way of one still to come', async () => {
    renderPage(
      stub({
        getMeetings: () =>
          Promise.resolve({
            meetings: [
              aMeeting({ id: 'm-old', title: 'Last month', starts_at: '2020-01-01T10:00:00.000Z' }),
              aMeeting({ id: 'm-soon', title: 'Next week' }),
            ],
          }),
      }),
    )

    expect(await screen.findByText('Next week')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Meetings that have been' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Also in the diary' })).toBeNull()
  })

  it('raises a point with what was typed', async () => {
    const addMeetingPoint = vi.fn<MeetingsApi['addMeetingPoint']>(() => Promise.resolve({ point: aPoint() }))
    renderPage(stub({ addMeetingPoint }))

    await screen.findByRole('button', { name: 'Raise it' })
    fireEvent.input(screen.getByLabelText('What is it?'), { target: { value: 'Where do we park?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Raise it' }))

    await waitFor(() =>
      expect(addMeetingPoint).toHaveBeenCalledWith('e-1', { title: 'Where do we park?', body: '' }),
    )
  })

  it('refuses to raise one with nothing in it, and says why', async () => {
    const addMeetingPoint = vi.fn<MeetingsApi['addMeetingPoint']>(() => Promise.resolve({ point: aPoint() }))
    renderPage(stub({ addMeetingPoint }))

    fireEvent.click(await screen.findByRole('button', { name: 'Raise it' }))

    expect(await screen.findByText('Say what the point is, so somebody can answer it.')).toBeTruthy()
    expect(addMeetingPoint).not.toHaveBeenCalled()
  })

  it('records a decision on the point it was pressed from', async () => {
    const decidePoint = vi.fn<MeetingsApi['decidePoint']>(() =>
      Promise.resolve({ point: aPoint({ decision: 'By the barn' }) }),
    )
    renderPage(stub({ getMeetingPoints: () => Promise.resolve({ points: [aPoint()] }), decidePoint }))

    fireEvent.click(await screen.findByRole('button', { name: 'Record decision' }))
    fireEvent.input(screen.getByLabelText('Decision, for Where do we park?'), {
      target: { value: 'By the barn' },
    })
    fireEvent.input(screen.getByLabelText('Where it was decided, for Where do we park?'), {
      target: { value: 'Planning call Oct 20' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Record it' }))

    await waitFor(() =>
      expect(decidePoint).toHaveBeenCalledWith('p-1', {
        decision: 'By the barn',
        decided_note: 'Planning call Oct 20',
      }),
    )
  })

  it('reopens an addressed point by clearing what was decided', async () => {
    const decidePoint = vi.fn<MeetingsApi['decidePoint']>(() => Promise.resolve({ point: aPoint() }))
    renderPage(
      stub({
        getMeetingPoints: () => Promise.resolve({ points: [aPoint({ decision: 'By the barn' })] }),
        decidePoint,
      }),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Reopen' }))

    await waitFor(() =>
      expect(decidePoint).toHaveBeenCalledWith('p-1', { decision: null, decided_note: null }),
    )
  })
})

describe('when a meeting is', () => {
  it('is read in the reader own timezone, the only one they can turn up in', () => {
    // `vite.config.ts` pins TZ=Europe/Stockholm.
    expect(whenItIs(aMeeting({ starts_at: '2026-07-20T17:00:00.000Z' }), new Date('2026-07-01'))).toBe(
      'Mon 20 Jul 19:00',
    )
  })

  it('answers back what it was given when that is not a date', () => {
    expect(whenItIs(aMeeting({ starts_at: 'not a date' }))).toBe('not a date')
  })
})
