import { useEffect, useMemo, useState } from 'preact/hooks'

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
  browser: supplied,
}: {
  api: PushApi
  browser?: PushBrowser | undefined
}) => {
  // Memoised, because `browserPush()` builds a fresh object each call. As a
  // default parameter it would be a new identity every render, so the effect
  // below would re-register the worker and re-derive state after each one rather
  // than on mount.
  const browser = useMemo(() => supplied ?? browserPush(), [supplied])
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
    //
    // And re-asserted, not merely read. The state comes from the browser, so the
    // one drift the page could not see is the *row* going missing while the
    // browser keeps its subscription — a restored volume, or an admin whose role
    // was removed and given back. The toggle would say "on" and nothing would
    // arrive, fixable only by pressing Stop and then Start. `rememberSubscription`
    // is an upsert keyed on the endpoint, so saying it again costs one request on
    // the settings page and heals that.
    void browser
      .register()
      .then((manager) => manager.getSubscription())
      .then(async (existing) => {
        setState(existing === null ? 'off' : 'on')
        if (existing === null) return

        const body = subscriptionBody(existing)
        // Swallowed: this is repair, not something the admin asked for, and a
        // failure leaves exactly the state they already had.
        if (body !== undefined) await api.subscribeToPush(body).catch(() => undefined)
      })
      .catch(() => setState('unsupported'))
  }, [api, browser])

  /** Best-effort: a browser that will not let go should not mask the real error. */
  const release = async (subscription: { unsubscribe: () => Promise<boolean> }) => {
    try {
      await subscription.unsubscribe()
    } catch {
      // The message the caller is about to show is the more useful one.
    }
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

      const manager = await browser.register()
      const subscription = await manager.subscribe({
        // Required by Chrome, and honest: every notification this sends is shown.
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
        // `subscribe()` already succeeded, so without this the browser holds a
        // subscription the server has no row for — and the next mount reads "on"
        // from `getSubscription()` while nothing can ever arrive. The same
        // asymmetry as leaving it subscribed on the way out, in the other
        // direction.
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
      const manager = await browser.register()
      const existing = await manager.getSubscription()

      if (existing !== null) {
        // Both halves, and the browser's goes first — deliberately. Leaving the
        // browser subscribed shows "on" with nothing behind it and no way back,
        // since the 'on' branch only offers to turn it off. Leaving the *row*
        // heals itself: the next application sends to an endpoint the browser has
        // released, the push service answers 410, and `notifyAdmins` deletes it.
        //
        // So if only one of these can happen, it should be this one.
        await existing.unsubscribe()
        released = true
        await api.unsubscribeFromPush(existing.endpoint)
      }
      setState('off')
    } catch (failure) {
      setError(isApiError(failure) ? failure.message : 'Could not turn notifications off here.')

      // Which state is truthful depends on how far it got. Once the browser has
      // let go, nothing can arrive whatever the server thinks — saying "on" would
      // offer a Stop button that hits the same failure forever, over a row that
      // deletes itself at the next 410.
      setState(released ? 'off' : 'on')
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
