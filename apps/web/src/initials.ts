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
