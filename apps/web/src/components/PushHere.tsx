import { useEffect, useMemo, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'
import type { PushBrowser, PushState } from '../push.ts'
import type { FormErrorState } from './FormError.tsx'

import { isApiError } from '../api/client.ts'
import { isStandalone } from '../install.ts'
import { browserPush, decodeVapidKey, subscriptionBody } from '../push.ts'
import { isApproved, useViewer } from '../viewer.tsx'
import { FormError, useFormError } from './FormError.tsx'

export type PushApi = Pick<ApiClient, 'getPushKey' | 'subscribeToPush' | 'unsubscribeFromPush'>

export const ACTIVATION_LIMIT_MS = 5000

export interface PushHere {
  state: PushState | 'working' | 'checking'
  error: FormErrorState
  turnOn: () => Promise<void>
  turnOff: () => Promise<void>
}

const registerWithin = async (browser: PushBrowser, limitMs: number) => {
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([
      browser.register(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('the service worker never activated')), limitMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export const usePushHere = (api: PushApi, supplied?: PushBrowser | undefined): PushHere => {
  const browser = useMemo(() => supplied ?? browserPush(), [supplied])
  const [state, setState] = useState<PushState | 'working' | 'checking'>(
    browser === undefined ? 'unsupported' : 'checking',
  )
  const [error, setError] = useFormError()

  useEffect(() => {
    if (browser === undefined) return

    if (browser.permission() === 'denied') {
      setState('blocked')
      return
    }

    void registerWithin(browser, ACTIVATION_LIMIT_MS)
      .then((manager) => manager.getSubscription())
      .then(async (existing) => {
        setState(existing === null ? 'off' : 'on')
        if (existing === null) return

        const body = subscriptionBody(existing)
        if (body !== undefined) await api.subscribeToPush(body).catch(() => undefined)
      })
      .catch(() => setState('unsupported'))
  }, [api, browser])

  const release = async (subscription: { unsubscribe: () => Promise<boolean> }) => {
    try {
      await subscription.unsubscribe()
    } catch {}
  }

  const turnOn = async () => {
    if (browser === undefined) return

    setState('working')
    setError(undefined)
    try {
      const permission = await browser.requestPermission()
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'blocked' : 'off')
        return
      }

      const { public_key } = await api.getPushKey()
      if (public_key === null) {
        setError('This installation cannot send notifications yet.')
        setState('off')
        return
      }

      const manager = await registerWithin(browser, ACTIVATION_LIMIT_MS)
      const subscription = await manager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeVapidKey(public_key),
      })

      const body = subscriptionBody(subscription)
      if (body === undefined) {
        setError('This browser gave us a subscription we cannot use.')
        await release(subscription)
        setState('off')
        return
      }

      try {
        await api.subscribeToPush(body)
      } catch (failure) {
        await release(subscription)
        throw failure
      }

      setState('on')
    } catch (failure) {
      setError(isApiError(failure) ? failure.message : 'Could not turn notifications on here.')
      setState('off')
    }
  }

  const turnOff = async () => {
    if (browser === undefined) return

    let released = false
    setState('working')
    setError(undefined)
    try {
      const manager = await registerWithin(browser, ACTIVATION_LIMIT_MS)
      const existing = await manager.getSubscription()

      if (existing !== null) {
        await existing.unsubscribe()
        released = true
        await api.unsubscribeFromPush(existing.endpoint)
      }
      setState('off')
    } catch (failure) {
      setError(isApiError(failure) ? failure.message : 'Could not turn notifications off here.')

      setState(released ? 'off' : 'on')
    }
  }

  return { state, error, turnOn, turnOff }
}

const InstallToUnlock = () => {
  const viewer = useViewer()

  return (
    <p class="form-note">
      Notifications are not available on this page. On an iPhone that is every browser until the app is
      installed — add it to your home screen and open it from there. Otherwise the site is not on HTTPS, which
      they also need. {isApproved(viewer) && <a href="/faq">More in the FAQ.</a>}
    </p>
  )
}

export const PushAsk = ({ push, blurb }: { push: PushHere; blurb?: string }) => {
  const { state } = push

  return (
    <>
      {state === 'unsupported' && !isStandalone() && <InstallToUnlock />}

      {state === 'unsupported' && isStandalone() && (
        <p class="form-note">
          This browser cannot show notifications, or the site is not on HTTPS. Notifications need both.
        </p>
      )}

      {state === 'blocked' && (
        <p class="form-note">
          This browser is blocking notifications for the site. Turning them back on is a change in the
          browser&rsquo;s own settings — the page cannot ask again once refused.
        </p>
      )}

      {(state === 'off' || state === 'on' || state === 'working' || state === 'checking') && (
        <>
          {blurb !== undefined && <p class="form-note">{blurb}</p>}

          <FormError error={push.error} />

          <button
            type="button"
            disabled={state === 'working' || state === 'checking'}
            onClick={() => void (state === 'on' ? push.turnOff() : push.turnOn())}
          >
            {state === 'working' || state === 'checking'
              ? 'One moment…'
              : state === 'on'
                ? 'Stop notifying me here'
                : 'Notify me here'}
          </button>
        </>
      )}
    </>
  )
}
