import { OAUTH_OUTCOME_PARAM } from '@sage-burner/shared'
import { useEffect, useState } from 'preact/hooks'

/**
 * The reason a provider round trip left in the URL, read once and then taken out (#393).
 *
 * A top-level navigation is the only channel back into the app, so the reason arrives as a
 * query parameter — and one left in place is announced again on every reload, telling
 * somebody about a link they made a week ago. `replaceState` rather than a push, so the back
 * button is not given an entry for the tidying up.
 *
 * Read into state before the parameter goes, because the page still has to say the thing
 * once.
 */
export const useOauthOutcome = (): string | null => {
  const [outcome] = useState(() => new URLSearchParams(window.location.search).get(OAUTH_OUTCOME_PARAM))

  useEffect(() => {
    if (outcome === null) return

    const url = new URL(window.location.href)
    url.searchParams.delete(OAUTH_OUTCOME_PARAM)
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }, [outcome])

  return outcome
}
