/**
 * How tall a text box should open (#338).
 *
 * Every editor in the app opened at three lines whatever was in it, so editing a page
 * of welcome text began by scrolling inside a sliver. It opens as tall as what it
 * already holds instead, and grows as somebody types — `rows` is recomputed from the
 * value, so a browser without `field-sizing: content` gets the same behaviour a line
 * at a time.
 *
 * The estimate is deliberately rough. A textarea's real width is not knowable from
 * here, so a long paragraph is counted as the lines it would wrap to at a nominal
 * width — near enough that a screen of prose opens as a screen, which is the whole
 * complaint, and never so wrong that a box opens absurdly.
 *
 * `field-sizing: content` would measure it exactly, and is not used: it makes the
 * browser ignore `rows`, so the fields that ask for a taller empty box — the burn's
 * payment and transfer texts — would open at the stylesheet's floor in Chrome and at
 * their own everywhere else. One behaviour in every browser is worth more here than
 * an exact one in a third of them.
 */

/** Three lines: what every box opened at, and still the floor for a short one. */
export const MIN_ROWS = 3

/**
 * The ceiling, so a long answer does not push Save off the bottom of the screen.
 * Scrolling inside a box that fills the viewport is the ordinary way to edit prose;
 * hunting for a button that is no longer on the page is not.
 */
export const MAX_ROWS = 24

/** The width the wrapping estimate assumes, in characters. */
const NOMINAL_COLUMNS = 72

export const rowsFor = (value: string, min: number = MIN_ROWS): number => {
  const wrapped = value
    .split('\n')
    .reduce((lines, line) => lines + Math.max(1, Math.ceil(line.length / NOMINAL_COLUMNS)), 0)

  // `min` wins over the ceiling as well: a caller asking for twelve rows has said
  // what the empty box should look like, and clamping that down to a smaller maximum
  // would be this module overruling it.
  return Math.min(Math.max(wrapped, min), Math.max(MAX_ROWS, min))
}
