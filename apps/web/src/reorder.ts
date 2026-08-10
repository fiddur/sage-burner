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

export const moveTo = (ids: readonly string[], from: number, to: number): string[] | undefined => {
  if (from === to || from < 0 || to < 0 || from >= ids.length || to >= ids.length) return undefined

  const next = [...ids]
  const [moved] = next.splice(from, 1)
  if (moved === undefined) return undefined
  next.splice(to, 0, moved)

  return next
}
