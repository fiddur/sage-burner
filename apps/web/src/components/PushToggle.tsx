import { useEffect, useMemo, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'
import type { PushBrowser, PushState } from '../push.ts'
import type { NotificationSettingsApi } from './NotificationSettingsField.tsx'

import { isApiError } from '../api/client.ts'
import { useInstallationSendsEmail } from '../installation.tsx'
import { browserPush, decodeVapidKey, subscriptionBody } from '../push.ts'
import { FormError, useFormError } from './FormError.tsx'
import { NotificationSettingsField } from './NotificationSettingsField.tsx'

export type PushApi = Pick<ApiClient, 'getPushKey' | 'subscribeToPush' | 'unsubscribeFromPush'> &
  NotificationSettingsApi

/**
 * How long to wait for a service worker to activate before calling push unavailable.
 *
 * `navigator.serviceWorker.ready` resolves once a registration covering the page has
 * an **active** worker, and if activation never happens it simply never settles —
 * `register()` rejecting is a different thing, already handled. Without a deadline
 * the toggle sits there with nothing that can be pressed, and no error either.
 * Far longer than activation takes, far shorter than forever.
 */
export const ACTIVATION_LIMIT_MS = 5000

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

/**
 * Being told when something happens to you, per browser rather than per person.
 *
 * A subscription belongs to the browser it was made in, so this reads as "notify me
 * on this device" and somebody with a laptop and a phone turns it on twice. Saying
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
  // The email column exists only where an admin has set a mail server up (#30). A
  // switch that cannot do anything reads as a promise.
  const sendsEmail = useInstallationSendsEmail()
  // 'checking' rather than 'off' until the effect below has read the browser: an
  // admin who presses a live button first can have `turnOn` finish and then be
  // overwritten by the effect's own answer, leaving the toggle saying the opposite
  // of what it just did.
  const [state, setState] = useState<PushState | 'working' | 'checking'>(
    browser === undefined ? 'unsupported' : 'checking',
  )
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
    void registerWithin(browser, ACTIVATION_LIMIT_MS)
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

      const manager = await registerWithin(browser, ACTIVATION_LIMIT_MS)
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
      const manager = await registerWithin(browser, ACTIVATION_LIMIT_MS)
      const existing = await manager.getSubscription()

      if (existing !== null) {
        // Both halves, and the browser's goes first — deliberately. Leaving the
        // browser subscribed shows "on" with nothing behind it and no way back,
        // since the 'on' branch only offers to turn it off. Leaving the *row*
        // heals itself: the next notification goes to an endpoint the browser has
        // released, the push service answers 410, and the delivery loop deletes it.
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

      {(state === 'off' || state === 'on' || state === 'working' || state === 'checking') && (
        <>
          <p class="form-note">
            Tells you when somebody hands you a lead role or takes you off one — and, if you organise, when
            someone applies to join. Per browser, so turn it on anywhere you want to hear about it.
          </p>

          <FormError error={error} />

          <button
            type="button"
            disabled={state === 'working' || state === 'checking'}
            onClick={() => void (state === 'on' ? turnOff() : turnOn())}
          >
            {state === 'working' || state === 'checking'
              ? 'One moment…'
              : state === 'on'
                ? 'Stop notifying me here'
                : 'Notify me here'}
          </button>
        </>
      )}

      {/* Below the per-browser toggle, and always shown: what a category is switched
          off for is the bell as much as the push, so this applies with no browser
          subscribed at all. */}
      <h3>What to tell me about</h3>
      <NotificationSettingsField api={api} sendsEmail={sendsEmail === true} />
    </section>
  )
}
