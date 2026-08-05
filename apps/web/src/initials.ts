/**
 * Initials for a circle — "Fredrik Liljegren" is FL, "Ada" is A.
 *
 * Two callers now: the corner in the bar, and the facilitator on a schedule chip.
 *
 * First and last word rather than every word, so a middle name does not produce a
 * circle of five letters. Falls back to a glyph rather than to an empty circle: an
 * account whose name nobody has filled in is ordinary, and that is exactly the
 * account whose owner most needs the link to the page that fixes it.
 *
 * `Intl.Segmenter` rather than `[0]`, because a string index takes half a surrogate
 * pair — a name starting with an emoji or an astral-plane character would render a
 * replacement glyph. Measured, not assumed.
 */
export const initials = (name: string | null | undefined): string => {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '👤'

  const first = words[0] ?? ''
  const last = words.length > 1 ? (words[words.length - 1] ?? '') : ''
  const letters = new Intl.Segmenter()

  return [first, last]
    .filter((word) => word !== '')
    .map((word) => [...letters.segment(word)][0]?.segment ?? '')
    .join('')
    .toLocaleUpperCase()
}
