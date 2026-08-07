/**
 * Rearranging a list of ids. `ReorderableList` is the only caller.
 *
 * `undefined` means "no move" rather than an error — moving the first row up is an
 * ordinary thing to try, and the caller's job is then to do nothing rather than to
 * send an unchanged order. Every reorder endpoint takes the whole list and rejects a
 * partial one, so an unchanged send is a wasted round trip at best.
 *
 * Separate from the component because these are the half that is worth testing
 * without a DOM.
 */

/** The row at `index` swapped with its neighbour, or nothing at either end. */
export const swap = (ids: readonly string[], index: number, by: -1 | 1): string[] | undefined => {
  const target = index + by
  if (target < 0 || target >= ids.length) return undefined

  const next = [...ids]
  const moved = next[index]
  const displaced = next[target]
  if (moved === undefined || displaced === undefined) return undefined
  next[index] = displaced
  next[target] = moved

  return next
}

/** The row at `from` lifted out and dropped at `to`, or nothing if that changes nothing. */
export const moveTo = (ids: readonly string[], from: number, to: number): string[] | undefined => {
  if (from === to || from < 0 || to < 0 || from >= ids.length || to >= ids.length) return undefined

  const next = [...ids]
  const [moved] = next.splice(from, 1)
  if (moved === undefined) return undefined
  next.splice(to, 0, moved)

  return next
}
