import { useBurns } from '../burn.tsx'
import { isAdmin, useViewer } from '../viewer.tsx'
import { ErrorText } from './ErrorText.tsx'

export const NoBurn = ({ absent }: { absent: string }) => {
  const { status } = useBurns()
  const admin = isAdmin(useViewer())

  if (status === 'loading') return <p class="form-note">Loading…</p>

  if (status === 'failed') {
    return <ErrorText message={`Could not load your burns, so ${absent}. Please reload the page.`} />
  }

  return (
    <p class="form-note">
      There is no burn planned yet, so {absent}.
      {admin && (
        <>
          {' '}
          Make one under <a href="/admin/events">Events</a>.
        </>
      )}
    </p>
  )
}
