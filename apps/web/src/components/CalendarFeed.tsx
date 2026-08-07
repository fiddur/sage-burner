import { apiRoutes } from '@sage-burner/shared'

import { CopyButton } from './CopyButton.tsx'

/**
 * The subscribe link for one burn's schedule (#258, #298).
 *
 * The feed has existed since the ICS work and nothing pointed at it, so it was only
 * reachable by typing a URL with a UUID in it. Built from `window.location.origin`,
 * like the invite link, because the API has no notion of its own public URL.
 *
 * **`webcal://`, not `https://`.** The point is a subscription that keeps itself up
 * to date; following the `https` URL downloads a snapshot that never changes, which
 * is the opposite. `webcal` is what asks an operating system to subscribe, and is
 * handled by Apple Calendar on macOS and iOS, Outlook on the desktop, and
 * Thunderbird. Google Calendar on Android does not take it and wants the URL pasted
 * into *Other calendars → From URL* — which is what the copy button is for, and why
 * that keeps the `https` form.
 *
 * It also fixes a bug it was not chosen for. `preact-iso` takes any click on a
 * same-origin `<a>` that carries no `download` or `target`, so the `https` link was
 * routed client-side, matched nothing and rendered "Nothing here"; only a reload
 * reached the backend. A `webcal:` URL has origin `"null"`, so the router's
 * `link.origin != location.origin` check leaves it alone.
 *
 * The UUID is the only thing protecting the feed, which is why the warning is here
 * rather than assumed — kept to the tooltip so the heading stays a heading.
 */
export const CalendarFeed = ({ eventId }: { eventId: string }) => {
  const url = `${window.location.origin}${apiRoutes.scheduleFeed.path(eventId)}`
  const subscribe = url.replace(/^https?:/, 'webcal:')

  return (
    <p class="calendar-feed form-note">
      <a
        href={subscribe}
        title="Opens in your calendar app and subscribes — it keeps itself up to date. Anyone holding the link can read the schedule, so keep it inside the gathering."
      >
        📅 Add to calendar
      </a>{' '}
      <CopyButton value={url} label="Copy link" />
    </p>
  )
}
