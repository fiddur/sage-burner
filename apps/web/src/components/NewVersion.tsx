import { changelogPage } from '@sage-burner/shared'
import { useEffect, useState } from 'preact/hooks'

import type { VersionApi } from '../version.ts'

import { hardenNavigation, watchForNewVersion } from '../version.ts'

export const NewVersion = ({ api, go }: { api: VersionApi; go?: (href: string) => void }) => {
  const [stale, setStale] = useState(false)

  useEffect(() => watchForNewVersion(api, () => setStale(true)), [api])

  useEffect(() => (stale ? hardenNavigation(go) : undefined), [stale, go])

  if (!stale) return null

  return (
    <p class="new-version" role="status">
      <span>A newer version of this page is out.</span>
      <button type="button" onClick={() => globalThis.location.reload()}>
        Reload
      </button>
      <a href={changelogPage()}>What&rsquo;s new</a>
    </p>
  )
}
