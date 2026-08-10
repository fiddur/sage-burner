import { apiRoutes } from '@sage-burner/shared'

import type { ApiClient } from '../api/client.ts'

import { useAction, useLoad } from '../load.ts'
import { isAdmin, useViewer } from '../viewer.tsx'
import { CopyButton } from './CopyButton.tsx'
import { ErrorText } from './ErrorText.tsx'
import { FormError } from './FormError.tsx'

export type CalendarFeedApi = Pick<ApiClient, 'getCalendarToken' | 'rotateCalendarToken'>

/**
 * The subscribe link for one burn's schedule (#258, #298, #408).
 *
 * **`webcal://`, not `https://`.** The point is a subscription that keeps itself up
 * to date; following the `https` URL downloads a snapshot that never changes, which
 * is the opposite. `webcal` is what asks an operating system to subscribe, and is
 * handled by Apple Calendar on macOS and iOS, Outlook on the desktop, and
 * Thunderbird. Google Calendar on Android does not take it and wants the URL pasted
 * into *Other calendars → From URL* — which is what the copy button is for, and why
 * that keeps the `https` form.
 *
 * It used to sidestep a routing bug as well, and no longer needs to: the client-side
 * router swallowed the `https` link until `ROUTER_SCOPE` put `/calendar/` outside what
 * it may claim (#422). Both forms reach the backend now.
 *
 * **The address is fetched rather than built from the burn's id.** It is
 * `event.feed_token`, which the public homepage is never told — keyed by the id, this
 * link was readable by any stranger who loaded the front page. The URL is still the only
 * thing protecting the feed, which is why the warning is here rather than assumed; what
 * changed is that it can now be taken back, and an admin is offered that.
 *
 * Built from `window.location.origin`, like the invite link, because the API has no
 * notion of its own public URL.
 */
export const CalendarFeed = ({ api, eventId }: { api: CalendarFeedApi; eventId: string }) => {
  const viewer = useViewer()
  const { loaded, reload } = useLoad(async (signal) => (await api.getCalendarToken(eventId, signal)).token, {
    key: eventId,
    fallback: 'Could not load the calendar link. Please reload the page.',
  })
  const { busy, formError, run } = useAction(reload)

  if (loaded.status === 'failed') return <ErrorText message={loaded.message} />
  if (loaded.status !== 'ready') return <p class="form-note">One moment…</p>

  const url = `${window.location.origin}${apiRoutes.scheduleFeed.path(loaded.data)}`
  const subscribe = url.replace(/^https?:/, 'webcal:')

  return (
    <>
      <p class="calendar-feed form-note">
        <a
          href={subscribe}
          title="Opens in your calendar app and subscribes — it keeps itself up to date. Anyone holding the link can read the schedule, so keep it inside the gathering."
        >
          📅 Add to calendar
        </a>{' '}
        <CopyButton value={url} label="Copy link" />
        {isAdmin(viewer) && (
          <button
            type="button"
            class="link-button"
            disabled={busy}
            title="Gives the feed a new address. Every calendar already subscribed to the old one stops updating, with nothing to tell them."
            onClick={() => {
              run(async () => {
                await api.rotateCalendarToken(eventId)
              }, 'Could not change the address. Please try again.')
            }}
          >
            New link
          </button>
        )}
      </p>

      <FormError error={formError} />
    </>
  )
}
