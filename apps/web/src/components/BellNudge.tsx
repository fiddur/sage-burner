import { useState } from 'preact/hooks'

import type { PushBrowser } from '../push.ts'
import type { PushApi } from './PushHere.tsx'

import { dismissedPushNudge, nudgedLater, nudgeLater } from '../push.ts'
import { FormError } from './FormError.tsx'
import { IconButton } from './IconButton.tsx'
import { usePushHere } from './PushHere.tsx'

const Strip = ({
  api,
  browser,
  onLater,
}: {
  api: PushApi
  browser?: PushBrowser | undefined
  onLater: () => void
}) => {
  const push = usePushHere(api, browser)

  if (push.state !== 'off' && push.state !== 'working') return null

  return (
    <aside class="bell-nudge" role="status">
      <p class="form-note">
        Push notifications are off on this device. Turn them on to hear as things happen.
      </p>

      <FormError error={push.error} />

      <button
        type="button"
        class="bell-nudge-on"
        disabled={push.state === 'working'}
        onClick={() => void push.turnOn()}
      >
        {push.state === 'working' ? 'One moment…' : 'Turn on'}
      </button>

      <IconButton icon="close" label="Not now" onClick={onLater} />
    </aside>
  )
}

/** `usePushHere` lives in `Strip` so a reader who has already said no registers no service worker. */
export const BellNudge = ({
  api,
  browser,
  lasting,
  visit,
}: {
  api: PushApi
  browser?: PushBrowser | undefined
  lasting?: Storage
  visit?: Storage
}) => {
  const [later, setLater] = useState(() => nudgedLater(visit) || dismissedPushNudge(lasting))

  if (later) return null

  return (
    <Strip
      api={api}
      browser={browser}
      onLater={() => {
        nudgeLater(visit)
        setLater(true)
      }}
    />
  )
}
