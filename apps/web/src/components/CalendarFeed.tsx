import { apiRoutes } from '@sage-burner/shared'

import type { ApiClient } from '../api/client.ts'

import { useAction, useLoad } from '../load.ts'
import { isAdmin, useViewer } from '../viewer.tsx'
import { CopyButton } from './CopyButton.tsx'
import { ErrorText } from './ErrorText.tsx'
import { FormError } from './FormError.tsx'
import { Icon } from './Icon.tsx'

export type CalendarFeedApi = Pick<ApiClient, 'getCalendarToken' | 'rotateCalendarToken'>

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
          <Icon name="calendar" /> Add to calendar
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
