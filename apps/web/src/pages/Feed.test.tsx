import type { Activity } from '@sage-burner/shared'

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
  aLine({ id: 'x-2', body: 'Bea is coming.', category: 'member_joined', link: '/members' }),
]

/** What the server sends somebody who has never touched the settings. */
const DEFAULTS = [
  'meal_role',
  'dream_role',
  'lead_role',
  'payment',
  'waiting_list_near',
  'waiting_list_pushed',
  'application',
] as const

const stub = (over: Partial<FeedApi> = {}, activity: Activity[] = TWO): FeedApi => ({
  getFeed: () => Promise.resolve({ activity }),
  getMyNotificationSettings: () => Promise.resolve({ on: [...DEFAULTS], email: [] }),
  updateMyNotificationSettings: () => Promise.resolve({ on: [...DEFAULTS], email: [] }),
  ...over,
})

const renderPage = (api: FeedApi, viewer: Viewer = ADA) =>
  render(
    <ViewerProvider viewer={viewer}>
      <Feed api={api} />
    </ViewerProvider>,
  )

describe('what everyone has been doing', () => {
  it('shows a line per thing, newest first as the server sent them', async () => {
    renderPage(stub())

    expect(await screen.findByText('Ada offered a dream: Sauna at dawn')).toBeTruthy()
    const lines = [...document.querySelectorAll('.feed-what')].map((one) => one.textContent)
    expect(lines).toEqual(['Ada offered a dream: Sauna at dawn', 'Bea is coming.'])
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
