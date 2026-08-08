import { useLocation } from 'preact-iso'
import { useEffect, useRef, useState } from 'preact/hooks'

/**
 * The one breakpoint, and the same one the stylesheet uses (#337).
 *
 * Two things have to agree about what a phone is: the bottom bar's layout, which is
 * CSS, and what the bar and the bell *render*, which is not — a nav that hid its
 * links with `display: none` would leave a second copy of every page link in the
 * accessibility tree, and a bell that only hid its panel would still have opened one
 * off-screen. So the query is written here as well, and any change has to move both.
 */
export const PHONE = '(max-width: 45rem)'

/**
 * Whether this is a phone-sized viewport, kept current as it changes.
 *
 * `matchMedia` is optional the way `install.ts` treats it: a browser without it
 * answers "not a phone", which is the layout everything worked in before.
 */
export const usePhone = (): boolean => {
  const [phone, setPhone] = useState(() => globalThis.matchMedia?.(PHONE).matches === true)

  useEffect(() => {
    const query = globalThis.matchMedia?.(PHONE)
    if (query === undefined) return undefined

    const answer = (change: MediaQueryListEvent) => setPhone(change.matches)
    // Read again rather than trusting the first render's answer: a rotation between
    // mount and effect would otherwise sit wrong until the *next* one.
    setPhone(query.matches)
    query.addEventListener('change', answer)

    return () => query.removeEventListener('change', answer)
  }, [])

  return phone
}

/**
 * How far a run of scrolling has to go before the bottom bar reacts (#340).
 *
 * On the run rather than on one event: momentum scrolling fires bursts of a pixel or
 * two, and a per-event threshold would never be crossed by any of them — the bar
 * would sit still through a whole flick and then flip on the one large event.
 */
const THRESHOLD = 24

/**
 * The top of the page, where the bar is always shown.
 *
 * This is also the whole of iOS's rubber-band at the top, which reports movement in
 * both directions while the finger is not moving at all.
 */
const REST = 48

export interface BarScroll {
  hidden: boolean
  /** Where the current run began — the last point the direction turned. */
  from: number
}

export const AT_REST: BarScroll = { hidden: false, from: 0 }

/**
 * Whether the page is close enough to its end for the bounce there to be expected.
 *
 * Its own function because the arithmetic is the part that is easy to get wrong, and
 * because nothing in a unit test can produce it: happy-dom lays nothing out, so
 * `scrollHeight` is 0 and every position would answer yes.
 */
export const nearTheEnd = (at: number, viewport: number, page: number): boolean =>
  at + viewport >= page - REST

/**
 * Where the bar should be after the window has scrolled to `at`.
 *
 * Pure, because the parts that are easy to get wrong are all arithmetic: which way a
 * burst of momentum events counts as going, what a bounce at either end does, and
 * whether a long slow scroll is still measured from where it started.
 */
export const scrolledTo = (state: BarScroll, at: number, nearEnd: boolean): BarScroll => {
  if (at <= REST) return AT_REST

  // The same bounce happens the other way round at the bottom, so nothing down there
  // may flip it: the bar stays as the scroll that got there left it.
  if (nearEnd) return { ...state, from: at }

  const moved = at - state.from

  if (moved > THRESHOLD) return { hidden: true, from: at }
  if (moved < -THRESHOLD) return { hidden: false, from: at }

  // Movement that has not gone far enough to count still drags the anchor along, as
  // long as it goes the way the bar already went. Without this a slow scroll down
  // would go on measuring from the top and the bar would never come back.
  if (state.hidden === at > state.from) return { ...state, from: at }

  return state
}

/**
 * The bottom bar, out of the way while somebody is reading down a page (#340).
 *
 * **It does nothing on the schedule grid and the meal plan**, which is a decision
 * rather than an oversight: both scroll internally against a `max-height` so their
 * sticky headers have a box to stick to, and `window` never scrolls on them. Letting
 * the page scroll instead would take those headers away on exactly the pages whose
 * rows are unreadable without them, which is a worse trade than a 3.5rem bar.
 *
 * Read on a frame rather than per event — a scroll fires far more often than a page
 * can paint — and reset on every route change, since a page arrived at while the bar
 * was hidden would otherwise have no nav until somebody scrolled up.
 */
export const useHidingBar = (enabled: boolean): boolean => {
  const [hidden, setHidden] = useState(false)
  const state = useRef<BarScroll>(AT_REST)
  const { path } = useLocation()

  useEffect(() => {
    state.current = AT_REST
    setHidden(false)

    if (!enabled) return undefined

    let frame = 0

    const measure = () => {
      frame = 0
      const at = globalThis.scrollY

      state.current = scrolledTo(
        state.current,
        at,
        nearTheEnd(at, globalThis.innerHeight, document.documentElement.scrollHeight),
      )
      setHidden(state.current.hidden)
    }

    const onScroll = () => {
      if (frame !== 0) return
      frame = requestAnimationFrame(measure)
    }

    globalThis.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      globalThis.removeEventListener('scroll', onScroll)
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [enabled, path])

  return hidden
}
