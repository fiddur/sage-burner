import { OAUTH_OUTCOME_PARAM } from '@sage-burner/shared'
import { useEffect, useState } from 'preact/hooks'

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
