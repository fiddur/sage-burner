import type { PushSubscriptionCreate } from '@sage-burner/shared'

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
 * Narrower than the real objects on purpose: this is every capability used, and
 * anything absent from a browser fails the `supportsPush` check rather than
 * throwing halfway through.
 */
export interface PushBrowser {
  requestPermission: () => Promise<NotificationPermission>
  permission: () => NotificationPermission
  register: () => Promise<{
    getSubscription: () => Promise<{ endpoint: string; toJSON: () => unknown } | null>
    // Optional, matching the DOM's own signature: required here, the real
    // `PushManager` would not be assignable to this.
    subscribe: (options?: PushSubscriptionOptionsInit) => Promise<{
      endpoint: string
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
      const registration = await navigator.serviceWorker.register('/sw.js')

      // `pushManager` is absent on iOS Safari outside an installed web app, which
      // is a real configuration a member will hit rather than an exotic one.
      if (registration.pushManager === undefined) throw new Error('push is unavailable here')

      return registration.pushManager
    },
  }
}
