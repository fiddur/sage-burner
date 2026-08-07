import { useEffect, useState } from 'preact/hooks'

import type { InstallWatch } from '../install.ts'

import { dismissedInstall, dismissInstall } from '../install.ts'

/**
 * A strip offering to install the app, where the browser will let us (#281).
 *
 * Renders nothing where there is no offer, which is every browser outside Chromium —
 * `install.ts` says why that is the whole answer rather than half of one.
 *
 * Dismissible, and remembered: the event fires on every visit until the app is
 * installed, so a nudge with no "not now" is a nudge for ever. Installing drops it
 * too — `watchInstalls` hears `appinstalled` and has nothing left to offer.
 *
 * `watch` is `null` in a tree that has none, which is every test that does not ask
 * for one. `null` rather than `undefined` so an explicit "none" cannot be swallowed
 * by a default (#288).
 */
export const InstallApp = ({ watch }: { watch: InstallWatch | null }) => {
  const [offer, setOffer] = useState(() => watch?.offer())
  const [dismissed, setDismissed] = useState(dismissedInstall)

  useEffect(() => {
    if (watch === null) return undefined

    // Read once on subscribing as well as on every change: the offer may have arrived
    // between this component's first render and its effect, and nothing fires twice.
    setOffer(watch.offer())

    return watch.onChange(() => setOffer(watch.offer()))
  }, [watch])

  if (offer === undefined || dismissed) return null

  return (
    <p class="install-app" role="status">
      <span>Add this to your home screen and it opens like an app.</span>
      <button
        type="button"
        onClick={() => {
          void offer.prompt()
          // Spent either way: the browser allows one prompt per event, and whether
          // somebody accepted is its business rather than ours. Installing is what
          // `appinstalled` reports; declining leaves the offer to come back next visit.
          watch?.taken()
        }}
      >
        Install
      </button>
      <button
        type="button"
        class="link-button"
        onClick={() => {
          dismissInstall()
          setDismissed(true)
        }}
      >
        Not now
      </button>
    </p>
  )
}
