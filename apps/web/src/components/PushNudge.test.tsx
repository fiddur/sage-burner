import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PushBrowser } from '../push.ts'
import type { PushToggleApi } from './PushToggle.tsx'

import { NUDGE_DISMISSED_KEY } from '../push.ts'
import { ViewerProvider } from '../viewer.tsx'
import { PushToggle } from './PushToggle.tsx'

afterEach(() => {
  cleanup()
  globalThis.localStorage.clear()
})

const aSubscription = (endpoint = 'https://push.example/one') => ({
  endpoint,
  unsubscribe: () => Promise.resolve(true),
  toJSON: () => ({ endpoint, keys: { p256dh: 'a-public-key', auth: 'a-secret' } }),
})

const aBrowser = (subscribed: boolean): PushBrowser => ({
  permission: () => 'default',
  requestPermission: () => Promise.resolve('granted'),
  register: () =>
    Promise.resolve({
      getSubscription: () => Promise.resolve(subscribed ? aSubscription() : null),
      subscribe: () => Promise.resolve(aSubscription()),
    }),
})

const stub = (over: Partial<PushToggleApi> = {}): PushToggleApi => ({
  getMyNotificationSettings: () => Promise.resolve({ on: [], email: [] }),
  updateMyNotificationSettings: (settings) => Promise.resolve({ on: [...settings.on], email: [] }),
  getPushKey: () => Promise.resolve({ public_key: 'BFakeKey_with-url-safe' }),
  subscribeToPush: () => Promise.resolve(undefined),
  unsubscribeFromPush: () => Promise.resolve(undefined),
  ...over,
})

const drawn = (api: PushToggleApi, browser: PushBrowser) =>
  render(
    <ViewerProvider
      viewer={{ status: 'signed-in', account: { id: 'a-1', name: 'Ada', avatar: null, roles: ['member'] } }}
    >
      <PushToggle api={api} browser={browser} />
    </ViewerProvider>,
  )

const NUDGE = 'Nothing will reach you on this device yet.'

/** Waits out the mount effect: until it has answered, the nudge is hidden by the state alone. */
const settled = async () => await screen.findAllByRole('button', { name: 'Notify me here' })

const tickTheFirst = async () => {
  const boxes = await screen.findAllByRole('checkbox')
  const first = boxes[0]
  if (first === undefined) throw new Error('no category to switch on')

  fireEvent.change(first, { target: { checked: true } })
}

describe('the nudge under the categories', () => {
  it('is not there before anything has been switched on', async () => {
    drawn(stub(), aBrowser(false))

    await screen.findAllByRole('checkbox')
    await settled()

    expect(screen.queryByText(NUDGE)).toBeNull()
  })

  it('says so when a category is switched on and this browser hears nothing', async () => {
    drawn(stub(), aBrowser(false))
    await tickTheFirst()

    expect(await screen.findByText(NUDGE)).toBeTruthy()
  })

  it('stays away where this browser is already subscribed', async () => {
    drawn(stub(), aBrowser(true))
    await tickTheFirst()

    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Stop notifying me here' })).toHaveLength(1),
    )
    expect(screen.queryByText(NUDGE)).toBeNull()
  })

  it('turns push on from where the tick was, without a trip to another page', async () => {
    const subscribeToPush = vi.fn<PushToggleApi['subscribeToPush']>(() => Promise.resolve(undefined))
    const { container } = drawn(stub({ subscribeToPush }), aBrowser(false))
    await tickTheFirst()
    await screen.findByText(NUDGE)

    const nudge = container.querySelector<HTMLElement>('.push-nudge')
    if (nudge === null) throw new Error('the nudge is not on the page')
    fireEvent.click(within(nudge).getByRole('button', { name: 'Notify me here' }))

    await waitFor(() => expect(subscribeToPush).toHaveBeenCalledTimes(1))
  })

  it('goes away for good when asked to, this browser being where that is decided', async () => {
    drawn(stub(), aBrowser(false))
    await tickTheFirst()
    await screen.findByText(NUDGE)

    fireEvent.click(screen.getByRole('button', { name: 'Do not ask me here' }))

    await waitFor(() => expect(screen.queryByText(NUDGE)).toBeNull())
    expect(globalThis.localStorage.getItem(NUDGE_DISMISSED_KEY)).toBe('yes')
  })

  it('stays away on the next visit once it has been refused', async () => {
    globalThis.localStorage.setItem(NUDGE_DISMISSED_KEY, 'yes')
    drawn(stub(), aBrowser(false))
    await tickTheFirst()

    await settled()

    expect(screen.queryByText(NUDGE)).toBeNull()
  })
})
