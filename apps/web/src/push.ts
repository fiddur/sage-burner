import type { PushSubscriptionCreate } from '@sage-burner/shared'

import { SERVICE_WORKER_URL } from './offline.ts'

export type PushState = 'unsupported' | 'blocked' | 'off' | 'on'

export interface PushBrowser {
  requestPermission: () => Promise<NotificationPermission>
  permission: () => NotificationPermission
  register: () => Promise<{
    getSubscription: () => Promise<{
      endpoint: string
      unsubscribe: () => Promise<boolean>
      toJSON: () => unknown
    } | null>
    subscribe: (options?: PushSubscriptionOptionsInit) => Promise<{
      endpoint: string
      unsubscribe: () => Promise<boolean>
      toJSON: () => unknown
    }>
  }>
}

export const decodeVapidKey = (base64Url: string): Uint8Array<ArrayBuffer> => {
  const padded = base64Url.padEnd(base64Url.length + ((4 - (base64Url.length % 4)) % 4), '=')
  const standard = padded.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(standard)

  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)

  return bytes
}

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

export const browserPush = (): PushBrowser | undefined => {
  if (typeof Notification === 'undefined') return undefined
  if (typeof navigator === 'undefined' || navigator.serviceWorker === undefined) return undefined

  return {
    requestPermission: () => Notification.requestPermission(),
    permission: () => Notification.permission,
    register: async () => {
      await navigator.serviceWorker.register(SERVICE_WORKER_URL)

      const registration = await navigator.serviceWorker.ready

      if (registration.pushManager === undefined) throw new Error('push is unavailable here')

      return registration.pushManager
    },
  }
}

export const NUDGE_DISMISSED_KEY = 'sage-burner:push-nudge-dismissed'

export const dismissedPushNudge = (store?: Storage): boolean => {
  try {
    const held = store ?? globalThis.localStorage

    return typeof held?.getItem(NUDGE_DISMISSED_KEY) === 'string'
  } catch {
    return false
  }
}

export const dismissPushNudge = (store?: Storage): void => {
  try {
    const held = store ?? globalThis.localStorage

    held?.setItem(NUDGE_DISMISSED_KEY, 'yes')
  } catch {}
}

// Session storage rather than local: the bell's strip is meant to come back, so its ✕ lasts
// until the browser is closed and no longer.
export const NUDGE_LATER_KEY = 'sage-burner:push-nudge-later'

export const nudgedLater = (store?: Storage): boolean => {
  try {
    const held = store ?? globalThis.sessionStorage

    return typeof held?.getItem(NUDGE_LATER_KEY) === 'string'
  } catch {
    return false
  }
}

export const nudgeLater = (store?: Storage): void => {
  try {
    const held = store ?? globalThis.sessionStorage

    held?.setItem(NUDGE_LATER_KEY, 'yes')
  } catch {}
}
