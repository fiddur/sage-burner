import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PushBrowser } from '../push.ts'
import type { PushApi } from './PushToggle.tsx'

import { apiError } from '../api/client.ts'
import { decodeVapidKey, subscriptionBody } from '../push.ts'
import { ViewerProvider } from '../viewer.tsx'
import { ACTIVATION_LIMIT_MS, PushToggle } from './PushToggle.tsx'

afterEach(cleanup)

/** A subscription shaped the way a real `PushSubscription` serialises. */
const aSubscription = (endpoint = 'https://push.example/one') => ({
  endpoint,
  unsubscribe: () => Promise.resolve(true),
  toJSON: () => ({ endpoint, keys: { p256dh: 'a-public-key', auth: 'a-secret' } }),
})

/**
 * A browser that remembers, the way a real one does.
 *
 * `getSubscription()` keeps answering until the subscription is released, which is
 * the behaviour that makes forgetting to release it a visible bug rather than a
 * tidiness point.
 */
const rememberingBrowser = (over: Partial<PushBrowser> = {}) => {
  let held: ReturnType<typeof aSubscription> | null = aSubscription('https://push.example/mine')
  const unsubscribe = vi.fn(() => {
    held = null
    return Promise.resolve(true)
  })
  // Spied so a test can wait for the mount effect to have consulted it. Asserting
  // the button's label without that passes on the initial state, before the effect
  // has said anything.
  const getSubscription = vi.fn(() => Promise.resolve(held === null ? null : { ...held, unsubscribe }))

  const browser = aBrowser({
    register: () =>
      Promise.resolve({
        getSubscription,
        subscribe: () => {
          held = aSubscription('https://push.example/mine')
          // The spy on both paths, so releasing a just-made subscription is
          // observable too — not only releasing one that was found.
          return Promise.resolve({ ...held, unsubscribe })
        },
      }),
    ...over,
  })

  return { browser, unsubscribe, getSubscription }
}

const aBrowser = (over: Partial<PushBrowser> = {}): PushBrowser => ({
  permission: () => 'default',
  requestPermission: () => Promise.resolve('granted'),
  register: () =>
    Promise.resolve({
      getSubscription: () => Promise.resolve(null),
      subscribe: () => Promise.resolve(aSubscription()),
    }),
  ...over,
})

/** The one call whose arguments a test needs to inspect. */
type Subscribe = Awaited<ReturnType<PushBrowser['register']>>['subscribe']

const stub = (over: Partial<PushApi> = {}): PushApi => ({
  getMyNotificationSettings: () => Promise.resolve({ on: [], email: [] }),
  updateMyNotificationSettings: () =>
    Promise.reject(new Error('updateMyNotificationSettings is not stubbed here')),
  getPushKey: () => Promise.resolve({ public_key: 'BFakeKey_with-url-safe' }),
  subscribeToPush: () => Promise.resolve(undefined),
  unsubscribeFromPush: () => Promise.resolve(undefined),
  ...over,
})

describe('decodeVapidKey', () => {
  it('reads the URL-safe alphabet the server hands out', () => {
    // `atob` only knows `+` and `/`. A key containing `-` or `_` decoded without
    // translating them is silently the wrong bytes, and Chrome then refuses the
    // subscription with a message that says nothing about base64.
    const standard = decodeVapidKey('++//')
    const urlSafe = decodeVapidKey('--__')

    expect([...urlSafe]).toEqual([...standard])
  })

  it('puts the padding back', () => {
    // The server's key is unpadded. `atob` throws on a length that is not a
    // multiple of four.
    expect(() => decodeVapidKey('QUJD')).not.toThrow()
    expect([...decodeVapidKey('QUJD')]).toEqual([65, 66, 67])
    expect([...decodeVapidKey('QUJDRA')]).toEqual([65, 66, 67, 68])
  })
})

describe('subscriptionBody', () => {
  it('reads the endpoint and both keys out of toJSON', () => {
    expect(subscriptionBody(aSubscription())).toEqual({
      endpoint: 'https://push.example/one',
      p256dh: 'a-public-key',
      auth: 'a-secret',
    })
  })

  it('gives up rather than throwing on a shape it does not recognise', () => {
    // A browser handing back something else should surface as "cannot use this",
    // not a stack trace out of a click handler.
    expect(subscriptionBody({ endpoint: 'e', toJSON: () => null })).toBeUndefined()
    expect(subscriptionBody({ endpoint: 'e', toJSON: () => ({ keys: {} }) })).toBeUndefined()
    expect(
      subscriptionBody({ endpoint: 'e', toJSON: () => ({ keys: { p256dh: 1, auth: 2 } }) }),
    ).toBeUndefined()
  })
})

describe('PushToggle', () => {
  it('says installing it is what unlocks this, where the page is in a tab', () => {
    render(<PushToggle api={stub()} browser={undefined} />)

    expect(screen.getByText(/add it to your home screen/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('points a member at the FAQ, and an applicant at nothing they cannot read', () => {
    render(
      <ViewerProvider
        viewer={{
          status: 'signed-in',
          account: { id: 'a-1', name: 'Ada', avatar: null, roles: ['member'] },
        }}
      >
        <PushToggle api={stub()} browser={undefined} />
      </ViewerProvider>,
    )

    expect(screen.getByRole('link', { name: 'More in the FAQ.' }).getAttribute('href')).toBe('/faq')
  })

  it('offers no FAQ link to somebody with no role, whose /faq is a guarded page', () => {
    render(
      <ViewerProvider
        viewer={{ status: 'signed-in', account: { id: 'a-1', name: 'Ada', avatar: null, roles: [] } }}
      >
        <PushToggle api={stub()} browser={undefined} />
      </ViewerProvider>,
    )

    expect(screen.getByText(/add it to your home screen/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'More in the FAQ.' })).toBeNull()
  })

  it('says the browser cannot do it at all once it is the installed copy', () => {
    // Installed and still unsupported means installing is not the answer, so pointing at it
    // again would send somebody in a circle.
    const media = vi.spyOn(globalThis, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
    try {
      render(<PushToggle api={stub()} browser={undefined} />)

      expect(screen.getByText(/cannot show notifications/)).toBeTruthy()
      expect(screen.queryByText(/add it to your home screen/)).toBeNull()
    } finally {
      media.mockRestore()
    }
  })

  it('offers no button when permission was already refused', async () => {
    // Nothing this page does can undo `denied`; the fix is in browser settings, so
    // a button that cannot work would be the wrong affordance.
    render(<PushToggle api={stub()} browser={aBrowser({ permission: () => 'denied' })} />)

    expect(await screen.findByText(/blocking notifications/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows it as already on when this browser has a subscription', async () => {
    // Permission persists, so a reload must not ask again or claim it is off.
    render(
      <PushToggle
        api={stub()}
        browser={aBrowser({
          register: () =>
            Promise.resolve({
              getSubscription: () => Promise.resolve(aSubscription()),
              subscribe: () => Promise.resolve(aSubscription()),
            }),
        })}
      />,
    )

    expect(await screen.findByRole('button', { name: 'Stop notifying me here' })).toBeTruthy()
  })

  it('re-asserts an existing subscription on mount, so a lost row heals', async () => {
    // The one drift the page cannot see by reading the browser: the row gone while
    // the browser keeps its subscription — a restored volume, or a role removed and
    // given back. Without this the toggle says "on" and nothing arrives, fixable
    // only by pressing Stop and then Start.
    const subscribeToPush = vi.fn<PushApi['subscribeToPush']>(() => Promise.resolve(undefined))
    const { browser } = rememberingBrowser()
    render(<PushToggle api={stub({ subscribeToPush })} browser={browser} />)

    await screen.findByRole('button', { name: 'Stop notifying me here' })

    await waitFor(() =>
      expect(subscribeToPush).toHaveBeenCalledWith({
        endpoint: 'https://push.example/mine',
        p256dh: 'a-public-key',
        auth: 'a-secret',
      }),
    )
  })

  it('does not re-assert when this browser has no subscription', async () => {
    const subscribeToPush = vi.fn<PushApi['subscribeToPush']>(() => Promise.resolve(undefined))
    render(<PushToggle api={stub({ subscribeToPush })} browser={aBrowser()} />)

    await screen.findByRole('button', { name: 'Notify me here' })

    expect(subscribeToPush).not.toHaveBeenCalled()
  })

  it('still shows on when the re-assertion is refused', async () => {
    // Repair, not something the admin asked for: a failure leaves exactly the state
    // they already had rather than an error they cannot act on.
    const { browser } = rememberingBrowser()
    render(
      <PushToggle
        api={stub({ subscribeToPush: () => Promise.reject(apiError(500, 'internal', 'Nope.')) })}
        browser={browser}
      />,
    )

    expect(await screen.findByRole('button', { name: 'Stop notifying me here' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('subscribes and sends the endpoint and keys', async () => {
    const subscribeToPush = vi.fn<PushApi['subscribeToPush']>(() => Promise.resolve(undefined))
    render(<PushToggle api={stub({ subscribeToPush })} browser={aBrowser()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Notify me here' }))

    await waitFor(() =>
      expect(subscribeToPush).toHaveBeenCalledWith({
        endpoint: 'https://push.example/one',
        p256dh: 'a-public-key',
        auth: 'a-secret',
      }),
    )
    expect(await screen.findByRole('button', { name: 'Stop notifying me here' })).toBeTruthy()
  })

  it('asks the browser with the key the server gave, decoded', async () => {
    const subscribe = vi.fn<Subscribe>(() => Promise.resolve(aSubscription()))
    render(
      <PushToggle
        api={stub({ getPushKey: () => Promise.resolve({ public_key: 'QUJD' }) })}
        browser={aBrowser({
          register: () => Promise.resolve({ getSubscription: () => Promise.resolve(null), subscribe }),
        })}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Notify me here' }))

    await waitFor(() => expect(subscribe).toHaveBeenCalled())
    const options = subscribe.mock.calls[0]?.[0]
    expect(options?.userVisibleOnly).toBe(true)
    // Narrowed rather than cast: `applicationServerKey` is a union in the DOM
    // types, and asserting the bytes is the whole point of the test.
    const key = options?.applicationServerKey
    expect(key instanceof Uint8Array).toBe(true)
    expect(key instanceof Uint8Array ? Array.from(key) : []).toEqual([65, 66, 67])
  })

  it('does not subscribe when permission is refused at the prompt', async () => {
    const subscribeToPush = vi.fn<PushApi['subscribeToPush']>(() => Promise.resolve(undefined))
    render(
      <PushToggle
        api={stub({ subscribeToPush })}
        browser={aBrowser({ requestPermission: () => Promise.resolve('denied') })}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Notify me here' }))

    expect(await screen.findByText(/blocking notifications/)).toBeTruthy()
    expect(subscribeToPush).not.toHaveBeenCalled()
  })

  it('says so when the installation has no key, without asking the browser', async () => {
    const subscribe = vi.fn<Subscribe>(() => Promise.resolve(aSubscription()))
    render(
      <PushToggle
        api={stub({ getPushKey: () => Promise.resolve({ public_key: null }) })}
        browser={aBrowser({
          register: () => Promise.resolve({ getSubscription: () => Promise.resolve(null), subscribe }),
        })}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Notify me here' }))

    expect((await screen.findByRole('alert')).textContent).toContain('cannot send notifications yet')
    expect(subscribe).not.toHaveBeenCalled()
  })

  it('reports a refusal from the API and stays off', async () => {
    render(
      <PushToggle
        api={stub({ subscribeToPush: () => Promise.reject(apiError(403, 'forbidden', 'No access.')) })}
        browser={aBrowser()}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Notify me here' }))

    expect((await screen.findByRole('alert')).textContent).toContain('No access.')
    expect(screen.getByRole('button', { name: 'Notify me here' })).toBeTruthy()
  })

  it('releases the browser subscription when the server refuses to store it', async () => {
    // The mirror of the turn-off defect: `subscribe()` has already succeeded by the
    // time the API call fails, so leaving it would give a browser subscribed with
    // no row behind it — and the next mount reads "on" from `getSubscription()`
    // while nothing can ever arrive.
    const { browser, unsubscribe } = rememberingBrowser()
    render(
      <PushToggle
        api={stub({ subscribeToPush: () => Promise.reject(apiError(401, 'unauthenticated', 'Sign in.')) })}
        browser={browser}
      />,
    )

    // This fake starts subscribed; turn it off first so the button offers to
    // subscribe, which is the path under test.
    fireEvent.click(await screen.findByRole('button', { name: 'Stop notifying me here' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Notify me here' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Sign in.')
    await waitFor(() => expect(unsubscribe).toHaveBeenCalledTimes(2))
  })

  it('unsubscribes by the endpoint the browser still holds', async () => {
    const unsubscribeFromPush = vi.fn<PushApi['unsubscribeFromPush']>(() => Promise.resolve(undefined))
    render(
      <PushToggle
        api={stub({ unsubscribeFromPush })}
        browser={aBrowser({
          register: () =>
            Promise.resolve({
              getSubscription: () => Promise.resolve(aSubscription('https://push.example/mine')),
              subscribe: () => Promise.resolve(aSubscription()),
            }),
        })}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Stop notifying me here' }))

    await waitFor(() => expect(unsubscribeFromPush).toHaveBeenCalledWith('https://push.example/mine'))
    expect(await screen.findByRole('button', { name: 'Notify me here' })).toBeTruthy()
  })

  it('releases the browser subscription as well as the server row', async () => {
    // Without this the browser keeps a live `PushSubscription`, `getSubscription()`
    // keeps answering, and the toggle reads "on" with nothing subscribed — and the
    // 'on' branch only offers to turn it off, so there is no way back.
    const { browser, unsubscribe } = rememberingBrowser()
    const unsubscribeFromPush = vi.fn<PushApi['unsubscribeFromPush']>(() => Promise.resolve(undefined))
    render(<PushToggle api={stub({ unsubscribeFromPush })} browser={browser} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Stop notifying me here' }))

    await waitFor(() => expect(unsubscribeFromPush).toHaveBeenCalledWith('https://push.example/mine'))
    expect(unsubscribe).toHaveBeenCalled()
  })

  it('says why the server refused, not why the browser would not let go', async () => {
    render(
      <PushToggle
        api={stub({ subscribeToPush: () => Promise.reject(apiError(500, 'internal', 'Nope.')) })}
        browser={aBrowser({
          register: () =>
            Promise.resolve({
              getSubscription: () => Promise.resolve(null),
              subscribe: () =>
                Promise.resolve({
                  ...aSubscription('https://push.example/mine'),
                  unsubscribe: () => Promise.reject(new Error('the browser said no')),
                }),
            }),
        })}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Notify me here' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Nope.')
  })

  it('can be turned back on after being turned off', async () => {
    // The consequence of the bug above, from the outside: the state the page
    // derives on mount has to agree with what the server was told.
    const { browser, getSubscription } = rememberingBrowser()
    const subscribeToPush = vi.fn<PushApi['subscribeToPush']>(() => Promise.resolve(undefined))
    render(<PushToggle api={stub({ subscribeToPush })} browser={browser} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Stop notifying me here' }))
    expect(await screen.findByRole('button', { name: 'Notify me here' })).toBeTruthy()

    // A reload, which is a fresh mount: `rerender` keeps the instance and its
    // state, so the effect would not re-run and this would assert nothing.
    cleanup()
    const before = getSubscription.mock.calls.length
    render(<PushToggle api={stub({ subscribeToPush })} browser={browser} />)

    // Waited for, not assumed: the effect settles asynchronously, and the initial
    // state is 'off' — so checking the label first passes whether or not the
    // subscription was released.
    await waitFor(() => expect(getSubscription.mock.calls.length).toBeGreaterThan(before))
    expect(screen.getByRole('button', { name: 'Notify me here' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Notify me here' }))
    await waitFor(() => expect(subscribeToPush).toHaveBeenCalled())
  })

  it('leaves the row rather than the browser when only one can be released', async () => {
    // Order matters, and this is which way. A leftover row heals itself — the next
    // application sends to a released endpoint, the push service answers 410 and
    // `notifyAdmins` deletes it — whereas a leftover browser subscription shows
    // "on" with nothing behind it and no way back.
    const { browser, unsubscribe } = rememberingBrowser()
    const unsubscribeFromPush = vi.fn<PushApi['unsubscribeFromPush']>(() =>
      Promise.reject(apiError(500, 'internal', 'Server fell over.')),
    )
    render(<PushToggle api={stub({ unsubscribeFromPush })} browser={browser} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Stop notifying me here' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Server fell over.')
    // The browser was released first, so the half that cannot heal itself is done.
    await waitFor(() => expect(unsubscribe).toHaveBeenCalled())
  })

  it('stays off when the browser was released but the server call failed', async () => {
    // Once the browser has let go, nothing can arrive whatever the server thinks.
    // Saying "on" would offer a Stop button that hits the same failure forever,
    // over a row that deletes itself at the next 410.
    const { browser } = rememberingBrowser()
    render(
      <PushToggle
        api={stub({ unsubscribeFromPush: () => Promise.reject(apiError(500, 'internal', 'Fell over.')) })}
        browser={browser}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Stop notifying me here' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Fell over.')
    expect(screen.getByRole('button', { name: 'Notify me here' })).toBeTruthy()
  })

  it('goes back to on when nothing was released at all', async () => {
    // The passing sibling: a failure *before* the browser let go leaves it
    // subscribed, so 'on' is the truthful state. Driven by a browser that
    // registers for the mount effect and then stops, since a register that fails
    // on mount is the unsupported branch instead.
    const subscription = { ...aSubscription('https://push.example/mine'), unsubscribe: vi.fn() }
    let registrations = 0
    const browser = aBrowser({
      register: () => {
        registrations += 1
        return registrations === 1
          ? Promise.resolve({
              getSubscription: () => Promise.resolve(subscription),
              subscribe: () => Promise.resolve(subscription),
            })
          : Promise.reject(new Error('worker gone'))
      },
    })
    render(<PushToggle api={stub()} browser={browser} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Stop notifying me here' }))

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Stop notifying me here' })).toBeTruthy()
    expect(subscription.unsubscribe).not.toHaveBeenCalled()
  })

  it('treats a browser whose service worker will not register as unsupported', async () => {
    // iOS Safari outside an installed web app, and any plain-HTTP deployment.
    render(
      <PushToggle api={stub()} browser={aBrowser({ register: () => Promise.reject(new Error('nope')) })} />,
    )

    expect(await screen.findByText(/add it to your home screen/)).toBeTruthy()
  })
})

describe('the two edges before the browser has answered', () => {
  /** A `register()` the test decides when to settle, so the mount effect can be caught mid-flight. */
  const suspendingBrowser = () => {
    let settle = (): void => undefined
    const browser = aBrowser({
      register: () =>
        new Promise((resolve) => {
          settle = () =>
            resolve({
              getSubscription: () => Promise.resolve(null),
              subscribe: () => Promise.resolve(aSubscription()),
            })
        }),
    })

    return { browser, settle: () => settle() }
  }

  it('offers nothing to press until it knows what this browser already has', async () => {
    // Live from the initial state, `turnOn` could finish and then be overwritten by
    // the effect's own answer — leaving the button saying the opposite of what it did.
    const { browser, settle } = suspendingBrowser()
    render(<PushToggle api={stub()} browser={browser} />)

    expect(screen.getByRole('button', { name: 'One moment…' }).hasAttribute('disabled')).toBe(true)

    settle()

    expect(await screen.findByRole('button', { name: 'Notify me here' })).toBeTruthy()
  })

  it('gives up on a worker that never activates, rather than waiting for one forever', async () => {
    // `navigator.serviceWorker.ready` never rejects: if activation does not happen it
    // simply never settles, and the toggle would sit on its initial state for good.
    vi.useFakeTimers()
    try {
      render(<PushToggle api={stub()} browser={aBrowser({ register: () => new Promise(() => undefined) })} />)

      await vi.advanceTimersByTimeAsync(ACTIVATION_LIMIT_MS + 1)

      expect(screen.getByText(/add it to your home screen/)).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('drops its deadline once the worker answers, leaving no timer behind', async () => {
    vi.useFakeTimers()
    try {
      const { browser, settle } = suspendingBrowser()
      render(<PushToggle api={stub()} browser={browser} />)
      settle()
      await vi.advanceTimersByTimeAsync(0)

      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('waits out a worker that is merely slow', async () => {
    // The passing sibling: a deadline of zero would satisfy the test above.
    vi.useFakeTimers()
    try {
      const { browser, settle } = suspendingBrowser()
      render(<PushToggle api={stub()} browser={browser} />)

      await vi.advanceTimersByTimeAsync(ACTIVATION_LIMIT_MS - 1)
      settle()
      await vi.advanceTimersByTimeAsync(0)

      expect(screen.getByRole('button', { name: 'Notify me here' })).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })
})
