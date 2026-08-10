import { useEffect, useState } from 'preact/hooks'

import type { InstallWatch } from '../install.ts'

import { dismissedInstall, dismissInstall } from '../install.ts'

export const InstallApp = ({ watch }: { watch: InstallWatch | null }) => {
  const [offer, setOffer] = useState(() => watch?.offer())
  const [dismissed, setDismissed] = useState(dismissedInstall)

  useEffect(() => {
    if (watch === null) return undefined

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
