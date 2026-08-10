import { useEffect, useState } from 'preact/hooks'

import type { VersionApi } from '../version.ts'

import { watchForNewVersion } from '../version.ts'

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
