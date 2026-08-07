import { useBurns } from '../burn.tsx'
import { isAdmin, useViewer } from '../viewer.tsx'
import { ErrorText } from './ErrorText.tsx'

/**
 * What a burn-scoped page says when there is no burn for it to be about.
 *
 * Four states rather than one, and the first is why this exists. The burns are
 * fetched once for the whole session, so a page mounted before they arrive sees no
 * selected burn and used to render its *definitive* copy — "There is no burn open at
 * the moment" — then correct itself a moment later. A brief flash of a wrong claim
 * is worse than a "Loading…", and the pages could not tell the two apart because
 * they read only `useSelectedBurn()`.
 *
 * A **failed** fetch is its own state rather than an empty list, because the other
 * two below are claims about the *reader* and that one is a fact about the request
 * (#193).
 *
 * The remaining two split the same way `choosableBurns` does, because that is what
 * decided the list is empty. An **admin** is offered every burn still to come,
 * so an empty selector means none is planned, and the fix is theirs. A **member** is
 * offered the ones they have joined, so an empty selector usually means they have
 * not joined one — and the fix is on their own page, not a person to ask.
 */
export const NoBurn = ({ absent }: { absent: string }) => {
  const { status } = useBurns()
  const admin = isAdmin(useViewer())

  if (status === 'loading') return <p class="form-note">Loading…</p>

  // Neither of the two below, because both are claims about the reader and this is a
  // fact about the request (#193). Telling somebody they are not coming to a burn when
  // the fetch simply failed is wrong, and points them at a page that will not help.
  if (status === 'failed') {
    return <ErrorText message={`Could not load your burns, so ${absent}. Please reload the page.`} />
  }

  return admin ? (
    <p class="form-note">
      There is no burn planned yet, so {absent}. Make one under <a href="/admin/events">Events</a>.
    </p>
  ) : (
    <p class="form-note">
      You are not coming to a burn yet, so {absent}. <a href="/profile">Your details</a> is where you say you
      are coming.
    </p>
  )
}
