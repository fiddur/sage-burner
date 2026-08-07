/**
 * Pinching the schedule to see more of it (#284).
 *
 * One scale factor for both axes rather than a dominant-direction guess: fingers
 * apart makes the hours taller *and* the lanes wider, fingers together makes both
 * smaller, so a burn with more places than a phone is wide can be squeezed until they
 * all fit — accepting that very little text will.
 *
 * The arithmetic is here so it can be tested. `Schedule.tsx` holds the two touches
 * and hands them over; nothing about a `TouchEvent` is needed to know what a pinch
 * means.
 */

/**
 * How far the grid may be squeezed and stretched.
 *
 * The floor is not the real limit horizontally: the table is `width: 100%`, so lanes
 * stop narrowing once they all fit the screen and only the hours keep shrinking.
 * That is the intended floor — "everything visible" — and this is the backstop under
 * a pinch that keeps going.
 */
export const ZOOM_MIN = 0.4
export const ZOOM_MAX = 2.5

/** Where a finger is. Enough of a `Touch` to measure a pinch by. */
export interface Point {
  clientX: number
  clientY: number
}

/** How far apart two fingers are, in both directions at once. */
export const touchGap = (first: Point, second: Point): number =>
  Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY)

/** What a pinch was holding when it started, so the move is measured against it. */
export interface Pinch {
  gap: number
  zoom: number
}

/**
 * The zoom a pinch has reached, from where it began.
 *
 * Relative to the gap at `touchstart` rather than to the last move, so the grid
 * follows the fingers exactly: let go and pinch again from the same place and it
 * lands where it was. Accumulating per move would drift.
 *
 * A gap of nought — two fingers on the same pixel, which a synthetic event can
 * produce — would divide to infinity, so it answers with what the pinch started at.
 */
export const pinchedZoom = (start: Pinch, gap: number): number => {
  if (start.gap <= 0) return start.zoom

  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, start.zoom * (gap / start.gap)))
}
