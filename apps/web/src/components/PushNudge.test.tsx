import type { ComponentChildren } from 'preact'

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PushBrowser } from '../push.ts'
import type { Viewer } from '../viewer.tsx'
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
  getMyNotificationSettings: () => Promise.resolve({ on: [], email: [], digest: 'daily' }),
  updateMyNotificationSettings: (settings) =>
    Promise.resolve({ on: [...settings.on], email: [], digest: 'daily' }),
  getPushKey: () => Promise.resolve({ public_key: 'BFakeKey_with-url-safe' }),
  subscribeToPush: () => Promise.resolve(undefined),
  unsubscribeFromPush: () => Promise.resolve(undefined),
  ...over,
})

const SIGNED_IN: Viewer = {
  status: 'signed-in',
  account: { id: 'a-1', name: 'Ada', avatar: null, roles: ['member'] },
}

const app = (
  api: PushToggleApi,
  browser: PushBrowser,
  elsewhere?: ComponentChildren,
  { viewer = SIGNED_IN, store }: { viewer?: Viewer; store?: Storage } = {},
) =>
  render(
    <ViewerProvider viewer={viewer}>
      <PushNudgeProvider store={store}>
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

const uncover = async (heading: string) => {
  fireEvent.click(await screen.findByRole('button', { name: heading }))
}

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
    await uncover('What others are doing')
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

describe('signing out', () => {
  it('takes the strip with it, rather than leaving it over the signed-out homepage (#588)', async () => {
    const { rerender } = app(stub(), aBrowser(false))
    await tick()
    expect(await screen.findByText(NUDGE)).toBeTruthy()

    rerender(
      <ViewerProvider viewer={{ status: 'signed-out' }}>
        <PushNudgeProvider>
          <PushNudge api={stub()} browser={aBrowser(false)} />
        </PushNudgeProvider>
      </ViewerProvider>,
    )

    await waitFor(() => expect(screen.queryByText(NUDGE)).toBeNull())
  })

  it('can be raised again after signing back in, the refusal not being what happened', async () => {
    const { rerender } = app(stub(), aBrowser(false))
    await tick()
    expect(await screen.findByText(NUDGE)).toBeTruthy()

    const signedOut = (viewer: Viewer) => (
      <ViewerProvider viewer={viewer}>
        <PushNudgeProvider>
          <PushToggle api={stub()} browser={aBrowser(false)} />
          <PushNudge api={stub()} browser={aBrowser(false)} />
        </PushNudgeProvider>
      </ViewerProvider>
    )

    rerender(signedOut({ status: 'signed-out' }))
    await waitFor(() => expect(screen.queryByText(NUDGE)).toBeNull())

    rerender(signedOut(SIGNED_IN))
    await tick()

    expect(await screen.findByText(NUDGE)).toBeTruthy()
  })
})

describe('where the refusal is kept', () => {
  it('reads and writes the store it is given rather than the global one (#588)', async () => {
    const held = new Map<string, string>()
    const store = {
      getItem: (key: string) => held.get(key) ?? null,
      setItem: (key: string, value: string) => void held.set(key, value),
      removeItem: (key: string) => void held.delete(key),
      clear: () => held.clear(),
      key: () => null,
      get length() {
        return held.size
      },
    } satisfies Storage

    app(stub(), aBrowser(false), undefined, { store })
    await tick()
    fireEvent.click(await screen.findByRole('button', { name: 'Do not ask me here' }))

    await waitFor(() => expect(held.has(NUDGE_DISMISSED_KEY)).toBe(true))
    expect(globalThis.localStorage.getItem(NUDGE_DISMISSED_KEY)).toBeNull()
  })

  it('stays away from the start where that store already holds a refusal', async () => {
    const store = { ...globalThis.localStorage, getItem: () => 'yes' } satisfies Storage

    app(stub(), aBrowser(false), undefined, { store })
    await tick()

    await waitFor(() => expect(screen.queryByText(NUDGE)).toBeNull())
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
