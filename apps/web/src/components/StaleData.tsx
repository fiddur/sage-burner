import { useEffect, useState } from 'preact/hooks'

import type { Freshness } from '../freshness.ts'

import { FRESH_FOR_MS } from '../freshness.ts'

/**
 * How often to re-ask the question. Far below five minutes, so the bar appears
 * within half a minute of the data going stale rather than whenever something else
 * happens to re-render.
 */
export const TICK_MS = 30_000

/**
 * A bar saying what is on screen is old (#256).
 *
 * Offline the app keeps working from what the service worker stored, which is the
 * point — but a roster that was true twenty minutes ago is exactly the thing somebody
 * would act on without noticing. So the rule is literal: past five minutes, say so.
 *
 * Almost unreachable while online, because the shared pages refetch on their own
 * while the tab is watched. That is deliberate rather than incidental — it is what
 * makes the bar mean "a refresh could not land" instead of "you have been reading a
 * while".
 *
 * No dismiss, for the same reason `NewVersion` has none: it describes a condition
 * rather than an event, and it stops being true on its own the moment a fetch lands.
 */
export const StaleData = ({
  freshness,
  now = () => Date.now(),
}: {
  freshness: Freshness
  now?: () => number
}) => {
  const [age, setAge] = useState<number | undefined>(undefined)

  useEffect(() => {
    const measure = () => {
      const latest = freshness.latest()
      setAge(latest === undefined ? undefined : now() - latest)
    }

    measure()
    const timer = setInterval(measure, TICK_MS)
    // Subscribed as well as ticking: a fetch landing has to clear the bar at once,
    // and waiting up to `TICK_MS` to stop calling fresh data stale would read as the
    // reload not having worked.
    const unsubscribe = freshness.subscribe(measure)

    return () => {
      clearInterval(timer)
      unsubscribe()
    }
  }, [freshness, now])

  // Nothing has loaded yet, so there is no claim to make about its age.
  if (age === undefined || age <= FRESH_FOR_MS) return null

  return (
    <p class="stale-data" role="status">
      <span>
        This is what was last loaded {Math.floor(age / 60_000)} minutes ago. It has not been able to refresh
        since, so somebody may have changed it.
      </span>
    </p>
  )
}
