import { useEffect, useState } from 'preact/hooks'

import type { InstallWatch } from '../install.ts'

import { dismissedInstall, dismissInstall } from '../install.ts'
import { isApproved, useViewer } from '../viewer.tsx'

export const INSTRUCTION = 'Open your browser’s share or menu and choose “Add to Home Screen”.'

export const WHY = 'Installed, it opens like an app — and on some phones that is what lets it notify you.'

export const InstallApp = ({ watch }: { watch: InstallWatch | null }) => {
  const [offer, setOffer] = useState(() => watch?.offer())
  const [dismissed, setDismissed] = useState(dismissedInstall)
  const viewer = useViewer()

  useEffect(() => {
    if (watch === null) return undefined

    setOffer(watch.offer())

    return watch.onChange(() => setOffer(watch.offer()))
  }, [watch])

  if (watch === null || dismissed || watch.standalone()) return null

  const notNow = (
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
  )

  // No offer means no `beforeinstallprompt`, which is every browser on iOS — all WebKit — and
  // Firefox and Safari on the desktop. Saying nothing there hid the nudge from exactly the
  // platform where installing takes the most convincing (#452). The wording stays generic on
  // purpose: an exact menu path goes stale silently, and the FAQ is where a walkthrough can be
  // edited without a deploy.
  if (offer === undefined) {
    return (
      <p class="install-app" role="status">
        <span>
          {INSTRUCTION} {WHY}
          {isApproved(viewer) && (
            <>
              {' '}
              <a href="/faq">More in the FAQ.</a>
            </>
          )}
        </span>
        {notNow}
      </p>
    )
  }

  return (
    <p class="install-app" role="status">
      <span>{WHY}</span>
      <button
        type="button"
        onClick={() => {
          void offer.prompt()
          watch.taken()
        }}
      >
        Install
      </button>
      {notNow}
    </p>
  )
}
