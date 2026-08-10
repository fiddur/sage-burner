import { useEffect, useState } from 'preact/hooks'

import type { Freshness } from '../freshness.ts'

import { FRESH_FOR_MS } from '../freshness.ts'

export const TICK_MS = 30_000

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
    const unsubscribe = freshness.subscribe(measure)

    return () => {
      clearInterval(timer)
      unsubscribe()
    }
  }, [freshness, now])

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
