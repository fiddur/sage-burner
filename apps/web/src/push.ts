import type { PushSubscriptionCreate } from '@sage-burner/shared'

import { SERVICE_WORKER_URL } from './offline.ts'

/**
 * Turning browser notifications on and off, apart from the component that offers
 * it.
 *
 * All four of the browser APIs involved — `Notification`, `navigator.serviceWorker`,
 * `PushManager`, and `atob` on a URL-safe base64 string — are absent, partial or
 * differently shaped depending on the browser and whether the page is a secure
 * context. Keeping them here means the page can be tested against a stub and this
 * can be tested against a fake, rather than a component that does both badly.
 */

/** What the toggle can be showing. */
export type PushState = 'unsupported' | 'blocked' | 'off' | 'on'

/**
 * Enough of the browser to turn notifications on, so a test can supply one.
 *
 * Narrower than the real objects on purpose: this is every capability used. What
 * happens when one is missing is split across two places — `browserPush()` returns
 * `undefined` when `Notification` or `navigator.serviceWorker` is absent, and
 * `register()` throws when `pushManager` is, since that is only knowable after
 * registering. Both surface as the toggle saying push is unavailable.
 */
export interface PushBrowser {
  requestPermission: () => Promise<NotificationPermission>
  permission: () => NotificationPermission
  register: () => Promise<{
    getSubscription: () => Promise<{
      endpoint: string
      unsubscribe: () => Promise<boolean>
      toJSON: () => unknown
    } | null>
    // Typed with the DOM's own `PushSubscriptionOptionsInit` so the real
    // `PushManager` is assignable — a hand-written `{ userVisibleOnly:
    // boolean; applicationServerKey: Uint8Array }` is not, because the DOM wants a
    // `BufferSource`. The `?` mirrors that signature and is not itself load-
    // bearing: TypeScript lets a function with an optional parameter satisfy one
    // that requires it.
    subscribe: (options?: PushSubscriptionOptionsInit) => Promise<{
      endpoint: string
      unsubscribe: () => Promise<boolean>
      toJSON: () => unknown
    }>
  }>
}

/**
 * The VAPID public key as the browser wants it.
 *
 * The server hands out URL-safe base64 — what VAPID specifies — and
 * `applicationServerKey` wants raw bytes. `atob` only reads the standard alphabet,
 * so `-` and `_` have to be translated and the padding put back, or Chrome refuses
 * the subscription with a message that says nothing about base64.
 */
export const decodeVapidKey = (base64Url: string): Uint8Array<ArrayBuffer> => {
  const padded = base64Url.padEnd(base64Url.length + ((4 - (base64Url.length % 4)) % 4), '=')
  const standard = padded.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(standard)

  // Built on its own `ArrayBuffer` rather than via `Uint8Array.from`, which types
  // as `ArrayBufferLike` and is not assignable to the DOM's `BufferSource`.
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)

  return bytes
}

/**
 * What a `PushSubscription` carries, in the shape the API takes.
 *
 * Read through `toJSON()` rather than off the object: the keys live in an
 * `ArrayBuffer` reachable only via `getKey()`, and `toJSON` is the one documented
 * way to get them as base64. Returns undefined rather than throwing when a browser
 * hands back something else, so the caller reports "could not turn this on" instead
 * of a stack trace.
 */
export const subscriptionBody = (subscription: {
  endpoint: string
  toJSON: () => unknown
}): PushSubscriptionCreate | undefined => {
  const json = subscription.toJSON()
  if (typeof json !== 'object' || json === null || !('keys' in json)) return undefined

  const { keys } = json
  if (typeof keys !== 'object' || keys === null) return undefined
  if (!('p256dh' in keys) || !('auth' in keys)) return undefined

  const { p256dh, auth } = keys
  if (typeof p256dh !== 'string' || typeof auth !== 'string') return undefined

  return { endpoint: subscription.endpoint, p256dh, auth }
}

/**
 * The browser, or nothing.
 *
 * Push needs a secure context and three separate APIs. An installation served over
 * plain HTTP has `navigator.serviceWorker` undefined, which is a configuration
 * problem rather than a browser being old — either way the toggle says
 * unsupported rather than failing when pressed.
 */
export const browserPush = (): PushBrowser | undefined => {
  if (typeof Notification === 'undefined') return undefined
  if (typeof navigator === 'undefined' || navigator.serviceWorker === undefined) return undefined

  return {
    requestPermission: () => Notification.requestPermission(),
    permission: () => Notification.permission,
    register: async () => {
      // A no-op once `registerServiceWorker` has run on load, which it has since
      // #256 — a registration is keyed on its URL. Kept because this is the path
      // that *needs* one, and it must not depend on the other having happened.
      await navigator.serviceWorker.register(SERVICE_WORKER_URL)

      // `register()` resolves before the worker activates, and `subscribe()`
      // requires an active one — the spec rejects with `InvalidStateError`, Chrome
      // with "Registration failed - no active Service Worker". That is the very
      // first turn-on, on the very first visit, which is the worst time for it.
      // `ready` is what waits for activation.
      const registration = await navigator.serviceWorker.ready

      // `pushManager` is absent on iOS Safari outside an installed web app, which
      // is a real configuration a member will hit rather than an exotic one.
      if (registration.pushManager === undefined) throw new Error('push is unavailable here')

      return registration.pushManager
    },
  }
}
