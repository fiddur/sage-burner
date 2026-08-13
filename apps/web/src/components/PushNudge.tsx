import type { PushBrowser } from '../push.ts'
import type { PushApi } from './PushHere.tsx'

import { usePushNudge } from '../push-nudge.tsx'
import { PushAsk, usePushHere } from './PushHere.tsx'

const Strip = ({
  api,
  browser,
  onDismiss,
}: {
  api: PushApi
  browser?: PushBrowser | undefined
  onDismiss: () => void
}) => {
  const push = usePushHere(api, browser)

  if (push.state === 'on' || push.state === 'checking') return null

  return (
    <aside class="push-nudge" role="status">
      <p class="form-note">
        <strong>Nothing will reach you on this device yet.</strong> Notifications are asked for per browser,
        so what you just switched on arrives in the bell — and nowhere else — until you turn them on here.
      </p>

      <PushAsk push={push} />

      <p class="form-note">
        <button type="button" class="link-button" onClick={onDismiss}>
          Do not ask me here
        </button>
      </p>
    </aside>
  )
}

/**
 * Mounted once, above the routed page, so switching a category on anywhere raises the same strip
 * with the same dismissal. `usePushHere` lives in `Strip` rather than here, so a page nobody has
 * ticked anything on registers no service worker and re-posts no subscription.
 */
export const PushNudge = ({ api, browser }: { api: PushApi; browser?: PushBrowser | undefined }) => {
  const { wanted, dismiss } = usePushNudge()

  if (!wanted) return null

  return <Strip api={api} browser={browser} onDismiss={dismiss} />
}
