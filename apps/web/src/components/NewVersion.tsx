import { useEffect, useState } from 'preact/hooks'

import type { VersionApi } from '../version.ts'

import { watchForNewVersion } from '../version.ts'

/**
 * A bar saying the app has been redeployed under this tab.
 *
 * Offered rather than done: a reload throws away whatever is half-typed, and at a
 * burn that is somebody's dream description or their allergies. The one exception
 * would be reloading on the next navigation, which is a natural break — but a member
 * filling a form and clicking a nav link has still lost it, so this asks.
 *
 * No dismiss. The tab is running code the server no longer serves, and a bar that can
 * be waved away is one somebody waves away and then reports the resulting oddity as
 * a bug.
 *
 * The changelog sits beside the reload rather than instead of it: what changed is worth
 * knowing, and a link cannot throw away what is half-typed (#325).
 */
export const NewVersion = ({ api }: { api: VersionApi }) => {
  const [stale, setStale] = useState(false)

  useEffect(() => watchForNewVersion(api, () => setStale(true)), [api])

  if (!stale) return null

  return (
    <p class="new-version" role="status">
      <span>A newer version of this page is out.</span>
      <button type="button" onClick={() => globalThis.location.reload()}>
        Reload
      </button>
      <a href="/changelog">What's new</a>
    </p>
  )
}
