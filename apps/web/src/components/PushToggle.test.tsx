import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PushBrowser } from '../push.ts'
import type { PushApi } from './PushToggle.tsx'

import { apiError } from '../api/client.ts'
import { decodeVapidKey, subscriptionBody } from '../push.ts'
import { PushToggle } from './PushToggle.tsx'

afterEach(cleanup)

/** A subscription shaped the way a real `PushSubscription` serialises. */
const aSubscription = (endpoint = 'https://push.example/one') => ({
  endpoint,
  toJSON: () => ({ endpoint, keys: { p256dh: 'a-public-key', auth: 'a-secret' } }),
})

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
  it('says so when the browser cannot do it at all', () => {
    render(<PushToggle api={stub()} browser={undefined} />)

    expect(screen.getByText(/cannot show notifications/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
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
    expect(key instanceof Uint8Array ? [...key] : []).toEqual([65, 66, 67])
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

  it('treats a browser whose service worker will not register as unsupported', async () => {
    // iOS Safari outside an installed web app, and any plain-HTTP deployment.
    render(
      <PushToggle api={stub()} browser={aBrowser({ register: () => Promise.reject(new Error('nope')) })} />,
    )

    expect(await screen.findByText(/cannot show notifications/)).toBeTruthy()
  })
})
