import { useEffect, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'
import type { PushBrowser, PushState } from '../push.ts'

import { isApiError } from '../api/client.ts'
import { browserPush, decodeVapidKey, subscriptionBody } from '../push.ts'
import { FormError, useFormError } from './FormError.tsx'

export type PushApi = Pick<ApiClient, 'getPushKey' | 'subscribeToPush' | 'unsubscribeFromPush'>

/**
 * Being told when someone applies, per browser rather than per person.
 *
 * A subscription belongs to the browser it was made in, so this reads as "notify me
 * on this device" and an admin with a laptop and a phone turns it on twice. Saying
 * "notify me" would be a promise the browser cannot keep.
 *
 * `browser` is injected so the suite can supply a fake: every API here is absent or
 * differently shaped somewhere, and a real one cannot be driven under happy-dom.
 */
export const PushToggle = ({
  api,
  browser = browserPush(),
}: {
  api: PushApi
  browser?: PushBrowser | undefined
}) => {
  const [state, setState] = useState<PushState | 'working'>(browser === undefined ? 'unsupported' : 'off')
  const [error, setError] = useFormError()

  useEffect(() => {
    if (browser === undefined) return

    // `denied` is worth showing as its own state: nothing this page does can undo
    // it, so offering a button that cannot work would be the wrong affordance —
    // the fix is in browser settings.
    if (browser.permission() === 'denied') {
      setState('blocked')
      return
    }

    // Asked rather than assumed: permission granted once persists, so a reload
    // should show "on" without the admin pressing anything again.
    void browser
      .register()
      .then((manager) => manager.getSubscription())
      .then((existing) => setState(existing === null ? 'off' : 'on'))
      .catch(() => setState('unsupported'))
  }, [browser])

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

      const manager = await browser.register()
      const subscription = await manager.subscribe({
        // Required by Chrome, and honest: every notification this sends is shown.
        userVisibleOnly: true,
        applicationServerKey: decodeVapidKey(public_key),
      })

      const body = subscriptionBody(subscription)
      if (body === undefined) {
        setError('This browser gave us a subscription we cannot use.')
        setState('off')
        return
      }

      await api.subscribeToPush(body)
      setState('on')
    } catch (failure) {
      setError(isApiError(failure) ? failure.message : 'Could not turn notifications on here.')
      setState('off')
    }
  }

  const turnOff = async () => {
    if (browser === undefined) return

    setState('working')
    setError(undefined)
    try {
      const manager = await browser.register()
      const existing = await manager.getSubscription()

      // Told to the server even when the browser has no subscription left to
      // report: the row is what causes notifications, and a browser that has
      // already forgotten locally would otherwise leave it behind forever.
      if (existing !== null) await api.unsubscribeFromPush(existing.endpoint)
      setState('off')
    } catch (failure) {
      setError(isApiError(failure) ? failure.message : 'Could not turn notifications off here.')
      setState('on')
    }
  }

  return (
    <section>
      <h2>Notifications</h2>

      {state === 'unsupported' && (
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

      {(state === 'off' || state === 'on' || state === 'working') && (
        <>
          <p class="form-note">
            Tells you when someone applies to join. Per browser, so turn it on anywhere you want to hear about
            it.
          </p>

          <FormError error={error} />

          <button
            type="button"
            disabled={state === 'working'}
            onClick={() => void (state === 'on' ? turnOff() : turnOn())}
          >
            {state === 'working'
              ? 'One moment…'
              : state === 'on'
                ? 'Stop notifying me here'
                : 'Notify me here'}
          </button>
        </>
      )}
    </section>
  )
}
