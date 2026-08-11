const SEMITONES = 12

const SHARP = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'] as const

const FLAT = ['A', 'Bb', 'B', 'C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab'] as const

const STEP: Record<string, number> = { A: 0, B: 2, C: 3, D: 5, E: 7, F: 8, G: 10 }

const SUFFIX = String.raw`(?:maj|min|sus|add|dim|aug|alt|m|M|°|ø|Δ|\+|-|\d+|[b#()])*`

const CHORD = new RegExp(`^([A-G])([#b]?)(${SUFFIX})(?:/([A-G])([#b]?))?$`, 'u')

const MARKERS = new Set(['N.C.', 'NC', '|', '||', '|:', ':|', '%', '-', '–', '/', '*'])

const REPEAT = /^x\d+$/iu

export interface Chord {
  root: string
  accidental: string
  suffix: string
  bass: string
  bassAccidental: string
}

export const parseChord = (token: string): Chord | undefined => {
  const [, root, accidental = '', suffix = '', bass = '', bassAccidental = ''] = CHORD.exec(token) ?? []
  if (root === undefined) return undefined

  return { root, accidental, suffix, bass, bassAccidental }
}

const tokensOf = (line: string): string[] => line.trim().split(/\s+/u).filter(Boolean)

export const isChordToken = (token: string): boolean =>
  MARKERS.has(token) || REPEAT.test(token) || parseChord(token) !== undefined

export const isChordLine = (line: string): boolean => {
  const tokens = tokensOf(line)

  return (
    tokens.length > 0 &&
    tokens.every((token) => isChordToken(token)) &&
    tokens.some((token) => parseChord(token) !== undefined)
  )
}

export const chordsIn = (body: string): string[] =>
  body
    .split('\n')
    .filter((line) => isChordLine(line))
    .flatMap((line) => tokensOf(line))
    .filter((token) => parseChord(token) !== undefined)

const noteIndex = (root: string, accidental: string): number => {
  const step = STEP[root] ?? 0
  const shift = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0

  return (step + shift + SEMITONES) % SEMITONES
}

const noteName = (index: number, flats: boolean): string => (flats ? FLAT : SHARP)[index] ?? ''

export const transposeChord = (token: string, semitones: number): string => {
  const chord = parseChord(token)
  if (chord === undefined) return token

  const by = ((semitones % SEMITONES) + SEMITONES) % SEMITONES
  const flats = chord.accidental === 'b' || chord.bassAccidental === 'b'
  const root = noteName((noteIndex(chord.root, chord.accidental) + by) % SEMITONES, flats)
  const bass =
    chord.bass === ''
      ? ''
      : `/${noteName((noteIndex(chord.bass, chord.bassAccidental) + by) % SEMITONES, flats)}`

  return `${root}${chord.suffix}${bass}`
}

/**
 * Column starts are held as close as a shifted token allows, so `Bb` becoming `B` does not
 * walk the rest of the line out from under the words it sits above.
 */
export const transposeLine = (line: string, semitones: number): string => {
  if (((semitones % SEMITONES) + SEMITONES) % SEMITONES === 0 || !isChordLine(line)) return line

  let out = ''
  let cursor = 0
  let ahead = 0

  for (const match of line.matchAll(/\S+/gu)) {
    const gap = line.slice(cursor, match.index)
    const width = gap === '' ? 0 : Math.max(1, gap.length - ahead)
    const shifted = transposeChord(match[0], semitones)

    ahead -= gap.length - width
    ahead += shifted.length - match[0].length
    out += ' '.repeat(width) + shifted
    cursor = match.index + match[0].length
  }

  return out
}

export const transposeBody = (body: string, semitones: number): string =>
  body
    .split('\n')
    .map((line) => transposeLine(line, semitones))
    .join('\n')

const OPEN_MAJOR = new Set(['C', 'D', 'E', 'G', 'A'])

const OPEN_MINOR = new Set(['D', 'E', 'A'])

const isMinor = (suffix: string): boolean => /^(?:m(?!aj)|min|-)/u.test(suffix)

const isOpenShape = (token: string): boolean => {
  const chord = parseChord(token)
  if (chord === undefined || chord.accidental !== '') return false

  return (isMinor(chord.suffix) ? OPEN_MINOR : OPEN_MAJOR).has(chord.root)
}

export interface CapoSuggestion {
  capo: number
  shapes: string[]
}

/**
 * The position that turns the most of a song's chords into open shapes. Ties go to the lower
 * capo, and capo 0 winning means there is nothing to suggest.
 */
export const capoSuggestion = (body: string): CapoSuggestion | undefined => {
  const chords = chordsIn(body)
  if (chords.length === 0) return undefined

  const scored = Array.from({ length: SEMITONES }, (_unused, capo) => {
    const shapes = chords.map((token) => transposeChord(token, -capo))

    return { capo, shapes, open: shapes.filter((shape) => isOpenShape(shape)).length }
  })

  const best = scored.reduce((found, one) => (one.open > found.open ? one : found))
  if (best.capo === 0) return undefined

  return { capo: best.capo, shapes: [...new Set(best.shapes)] }
}

export type MusicMark =
  | 'apple-music'
  | 'bandcamp'
  | 'deezer'
  | 'elsewhere'
  | 'genius'
  | 'soundcloud'
  | 'spotify'
  | 'tidal'
  | 'ultimate-guitar'
  | 'youtube'
  | 'youtube-music'

export interface MusicHost {
  label: string
  mark: MusicMark
}

const MUSIC_HOSTS: readonly { host: RegExp; info: MusicHost }[] = [
  { host: /^music\.youtube\.com$/iu, info: { label: 'YouTube Music', mark: 'youtube-music' } },
  { host: /(^|\.)spotify\.com$/iu, info: { label: 'Spotify', mark: 'spotify' } },
  { host: /(^|\.)(?:youtube\.com|youtu\.be)$/iu, info: { label: 'YouTube', mark: 'youtube' } },
  { host: /(^|\.)soundcloud\.com$/iu, info: { label: 'SoundCloud', mark: 'soundcloud' } },
  { host: /(^|\.)bandcamp\.com$/iu, info: { label: 'Bandcamp', mark: 'bandcamp' } },
  { host: /(^|\.)music\.apple\.com$/iu, info: { label: 'Apple Music', mark: 'apple-music' } },
  { host: /(^|\.)deezer\.com$/iu, info: { label: 'Deezer', mark: 'deezer' } },
  { host: /(^|\.)tidal\.com$/iu, info: { label: 'TIDAL', mark: 'tidal' } },
  { host: /(^|\.)ultimate-guitar\.com$/iu, info: { label: 'Ultimate Guitar', mark: 'ultimate-guitar' } },
  { host: /(^|\.)genius\.com$/iu, info: { label: 'Genius', mark: 'genius' } },
]

const authorityOf = (url: string): string | undefined => {
  const [, authority] = /^https?:\/\/([^\s/\\?#]+)/iu.exec(url.trim()) ?? []

  return authority
}

export const musicHost = (url: string): MusicHost | undefined => {
  const authority = authorityOf(url)
  if (authority === undefined) return undefined

  const [host = authority] = authority.split(':')

  return MUSIC_HOSTS.find((known) => known.host.test(host))?.info
}
