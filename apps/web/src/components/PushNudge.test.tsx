import type { ComponentChildren } from 'preact'

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PushBrowser } from '../push.ts'
import type { PushToggleApi } from './PushToggle.tsx'

import { PushNudgeProvider, usePushNudge } from '../push-nudge.tsx'
import { NUDGE_DISMISSED_KEY } from '../push.ts'
import { ViewerProvider } from '../viewer.tsx'
import { PushNudge } from './PushNudge.tsx'
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

/**
 * The strip and the settings table under one provider, which is the whole point of the shape:
 * mounted separately they could not be asked whether they share a dismissal.
 */
const app = (api: PushToggleApi, browser: PushBrowser, elsewhere?: ComponentChildren) =>
  render(
    <ViewerProvider
      viewer={{ status: 'signed-in', account: { id: 'a-1', name: 'Ada', avatar: null, roles: ['member'] } }}
    >
      <PushNudgeProvider>
        <PushToggle api={api} browser={browser} />
        {elsewhere}
        <PushNudge api={api} browser={browser} />
      </PushNudgeProvider>
    </ViewerProvider>,
  )

const NUDGE = 'Nothing will reach you on this device yet.'

const tick = async (name?: string) => {
  const boxes = await screen.findAllByRole('checkbox')
  const box = name === undefined ? boxes[0] : screen.getByRole('checkbox', { name })
  if (box === undefined) throw new Error('no category to switch on')

  fireEvent.change(box, { target: { checked: true } })
}

/** Waits out the mount effect: until it has answered, the nudge is hidden by the state alone. */
const settled = async () => await screen.findAllByRole('button', { name: 'Notify me here' })

const Elsewhere = () => {
  const { askAbout } = usePushNudge()

  return (
    <button type="button" onClick={askAbout}>
      Notify me on similar
    </button>
  )
}

describe('the nudge', () => {
  it('is not there before anything has been switched on', async () => {
    app(stub(), aBrowser(false))

    await screen.findAllByRole('checkbox')
    await settled()

    expect(screen.queryByText(NUDGE)).toBeNull()
  })

  it('says so when a category is switched on and this browser hears nothing', async () => {
    app(stub(), aBrowser(false))

    await tick()

    expect(await screen.findByText(NUDGE)).toBeTruthy()
  })

  it('stays away where this browser is already subscribed', async () => {
    app(stub(), aBrowser(true))
    await tick()

    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Stop notifying me here' })).toHaveLength(1),
    )
    expect(screen.queryByText(NUDGE)).toBeNull()
  })

  it('turns push on from the strip itself, without a trip to another page', async () => {
    const subscribeToPush = vi.fn<PushToggleApi['subscribeToPush']>(() => Promise.resolve(undefined))
    const { container } = app(stub({ subscribeToPush }), aBrowser(false))
    await tick()
    await screen.findByText(NUDGE)

    const strip = container.querySelector<HTMLElement>('.push-nudge')
    if (strip === null) throw new Error('the nudge is not on the page')
    fireEvent.click(within(strip).getByRole('button', { name: 'Notify me here' }))

    await waitFor(() => expect(subscribeToPush).toHaveBeenCalledTimes(1))
  })

  it('goes for good when asked to, this browser being where that is decided', async () => {
    app(stub(), aBrowser(false))
    await tick()
    await screen.findByText(NUDGE)

    fireEvent.click(screen.getByRole('button', { name: 'Do not ask me here' }))

    await waitFor(() => expect(screen.queryByText(NUDGE)).toBeNull())
    expect(globalThis.localStorage.getItem(NUDGE_DISMISSED_KEY)).toBe('yes')
  })

  it('stays away for every later switch in the same sitting, once refused', async () => {
    app(stub(), aBrowser(false))
    await tick('Somebody offers a dream — Here')
    await screen.findByText(NUDGE)
    fireEvent.click(screen.getByRole('button', { name: 'Do not ask me here' }))
    await waitFor(() => expect(screen.queryByText(NUDGE)).toBeNull())

    await tick('Somebody comments on any dream — Here')

    expect(screen.queryByText(NUDGE)).toBeNull()
  })

  it('stays away on the next visit once it has been refused', async () => {
    globalThis.localStorage.setItem(NUDGE_DISMISSED_KEY, 'yes')
    app(stub(), aBrowser(false))
    await tick()

    await settled()

    expect(screen.queryByText(NUDGE)).toBeNull()
  })
})

describe('what else can raise it', () => {
  it('is any control that says a category was switched on, sharing the one strip', async () => {
    app(stub(), aBrowser(false), <Elsewhere />)
    await settled()

    fireEvent.click(screen.getByRole('button', { name: 'Notify me on similar' }))

    expect(await screen.findByText(NUDGE)).toBeTruthy()
  })

  it('is refused for all of them at once, not one control at a time', async () => {
    app(stub(), aBrowser(false), <Elsewhere />)
    await settled()
    fireEvent.click(screen.getByRole('button', { name: 'Notify me on similar' }))
    await screen.findByText(NUDGE)
    fireEvent.click(screen.getByRole('button', { name: 'Do not ask me here' }))
    await waitFor(() => expect(screen.queryByText(NUDGE)).toBeNull())

    await tick()

    expect(screen.queryByText(NUDGE)).toBeNull()
  })
})
