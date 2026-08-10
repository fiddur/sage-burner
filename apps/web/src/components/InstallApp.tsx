import { useEffect, useState } from 'preact/hooks'

import type { InstallWatch } from '../install.ts'

import { dismissedInstall, dismissInstall } from '../install.ts'
import { isApproved, useViewer } from '../viewer.tsx'

export const INSTRUCTION = 'Open your browser’s share or menu and choose “Add to Home Screen”.'

export const WHY = 'Installed, it opens like an app — and on some phones that is what lets it notify you.'

export const InstallApp = ({ watch }: { watch: InstallWatch | null }) => {
  const [offer, setOffer] = useState(() => watch?.offer())
  // A spent offer is not "this browser has no API": the strip would flip to the instructions
  // on top of Chromium's own install dialog, and stay there afterwards, since a tab's display
  // mode is `browser` however the dialog was answered.
  const [offered, setOffered] = useState(() => watch?.offer() !== undefined)
  const [dismissed, setDismissed] = useState(dismissedInstall)
  const viewer = useViewer()

  useEffect(() => {
    if (watch === null) return undefined

    const held = () => {
      const found = watch.offer()
      if (found !== undefined) setOffered(true)
      setOffer(found)
    }

    held()

    return watch.onChange(held)
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

  if (offer === undefined && offered) return null

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
