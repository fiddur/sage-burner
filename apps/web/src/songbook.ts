import { isChordLine, transposeLine } from '@sage-burner/shared'

export interface SongRow {
  chords: string | null
  words: string | null
}

export const songRows = (body: string, semitones = 0): SongRow[] => {
  const lines = body.split('\n')
  const rows: SongRow[] = []

  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at] ?? ''

    if (!isChordLine(line)) {
      rows.push({ chords: null, words: line })
      continue
    }

    const under = lines[at + 1]
    const sung = under !== undefined && under.trim() !== '' && !isChordLine(under)

    rows.push({ chords: transposeLine(line, semitones), words: sung ? under : null })
    if (sung) at += 1
  }

  return rows
}

export const columnsFitting = (width: number, character: number): number =>
  width > 0 && character > 0 ? Math.max(1, Math.floor(width / character)) : Number.POSITIVE_INFINITY

const blankAt = (line: string, at: number): boolean => at >= line.length || /\s/u.test(line[at] ?? '')

const runStart = (line: string, at: number): number => {
  let start = at
  while (start > 0 && blankAt(line, start - 1)) start -= 1

  return start
}

const leading = (line: string): number =>
  line === '' ? Number.POSITIVE_INFINITY : line.length - line.trimStart().length

const breakColumn = (chords: string, words: string, columns: number): number => {
  const starts = [...chords.matchAll(/\S+/gu)].map((found) => found.index)

  for (let at = columns; at > 0; at -= 1) {
    if (!blankAt(words, at) || !blankAt(chords, at)) continue

    const from = runStart(words, at)
    const stranded = starts.some((start) => start >= from && start < at) && words.slice(at).trim() !== ''
    if (!stranded) return at
  }

  return 0
}

const piece = (row: SongRow, chords: string, words: string, split: boolean): SongRow => ({
  chords: row.chords === null || (split && chords.trim() === '') ? null : chords.trimEnd(),
  words: row.words === null || (split && words.trim() === '') ? null : words.trimEnd(),
})

const broken = (row: SongRow, columns: number): SongRow[] => {
  const pieces: SongRow[] = []
  let chords = row.chords ?? ''
  let words = row.words ?? ''

  if (chords.trim() === '' && words.trim() === '') return [piece(row, chords, words, false)]

  while (Math.max(chords.length, words.length) > columns) {
    const at = breakColumn(chords, words, columns)
    if (at === 0) break

    pieces.push(piece(row, chords.slice(0, at), words.slice(0, at), true))

    const restChords = chords.slice(at)
    const restWords = words.slice(at)
    const shared = Math.min(leading(restChords), leading(restWords))

    chords = Number.isFinite(shared) ? restChords.slice(shared) : restChords
    words = Number.isFinite(shared) ? restWords.slice(shared) : restWords
  }

  return [...pieces, piece(row, chords, words, pieces.length > 0)]
}

export const wrappedRows = (rows: readonly SongRow[], columns: number): SongRow[] =>
  Number.isFinite(columns) && columns > 0 ? rows.flatMap((row) => broken(row, columns)) : [...rows]

export const SPEED_KEY = 'songbook:speed'

export const MIN_SPEED = 1

export const MAX_SPEED = 20

export const DEFAULT_SPEED = 6

export const TICK_MS = 50

const clamped = (speed: number): number =>
  Number.isFinite(speed) ? Math.min(MAX_SPEED, Math.max(MIN_SPEED, Math.round(speed))) : DEFAULT_SPEED

export const rememberedSpeed = (storage: Pick<Storage, 'getItem'> | undefined): number => {
  try {
    const held = storage?.getItem(SPEED_KEY)

    return held === null || held === undefined ? DEFAULT_SPEED : clamped(Number(held))
  } catch {
    return DEFAULT_SPEED
  }
}

export const rememberSpeed = (storage: Pick<Storage, 'setItem'> | undefined, speed: number): void => {
  try {
    storage?.setItem(SPEED_KEY, String(clamped(speed)))
  } catch {
    return
  }
}

const TENTHS = 10

export interface ScrollStep {
  move: number
  tenths: number
}

export const scrollStep = (tenths: number, speed: number): ScrollStep => {
  const owed = tenths + clamped(speed)
  const move = Math.floor(owed / TENTHS)

  return { move, tenths: owed - move * TENTHS }
}

export const MOST_SEMITONES = 11

export const shifted = (semitones: number, by: number): number =>
  Math.min(MOST_SEMITONES, Math.max(-MOST_SEMITONES, semitones + by))
