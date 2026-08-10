import { OAUTH_OUTCOME_PARAM, OAUTH_REF_PARAM } from '@sage-burner/shared'
import { useEffect, useState } from 'preact/hooks'

export interface OauthOutcome {
  outcome: string | null
  ref: string | null
}

const quotable = (value: string | null): string | null =>
  value !== null && /^[\w-]{1,32}$/u.test(value) ? value : null

export const quoting = (ref: string | null): string => (ref === null ? '' : ` Mention ${ref}.`)

export const useOauthOutcome = (): OauthOutcome => {
  const [held] = useState<OauthOutcome>(() => {
    const query = new URLSearchParams(window.location.search)

    return { outcome: query.get(OAUTH_OUTCOME_PARAM), ref: quotable(query.get(OAUTH_REF_PARAM)) }
  })

  useEffect(() => {
    if (held.outcome === null) return

    const url = new URL(window.location.href)
    url.searchParams.delete(OAUTH_OUTCOME_PARAM)
    url.searchParams.delete(OAUTH_REF_PARAM)
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }, [held])

  return held
}
