import { apiRoutes } from '@sage-burner/shared'

import { CopyButton } from './CopyButton.tsx'

/**
 * The subscribe link for one burn's schedule (#258).
 *
 * The feed has existed since the ICS work and nothing pointed at it, so it was only
 * reachable by typing a URL with a UUID in it. Built from `window.location.origin`,
 * like the invite link, because the API has no notion of its own public URL.
 *
 * The copy button is the part that works: following the link downloads a snapshot in
 * most browsers, where the point is a subscription that keeps up. The UUID is the
 * only thing protecting the feed, which is why the warning is here rather than
 * assumed — kept to the tooltip so the heading stays a heading.
 */
export const CalendarFeed = ({ eventId }: { eventId: string }) => {
  const url = `${window.location.origin}${apiRoutes.scheduleFeed.path(eventId)}`

  return (
    <p class="calendar-feed form-note">
      <a
        href={url}
        title="Paste this into your calendar app to subscribe — it keeps itself up to date. Anyone holding the link can read the schedule, so keep it inside the gathering."
      >
        📅 Calendar feed
      </a>{' '}
      <CopyButton value={url} label="Copy link" />
    </p>
  )
}
