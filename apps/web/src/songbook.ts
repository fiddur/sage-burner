import { isChordLine, transposeLine } from '@sage-burner/shared'

export interface SongLine {
  text: string
  chords: boolean
}

export const songLines = (body: string, semitones = 0): SongLine[] =>
  body.split('\n').map((line) => ({ text: transposeLine(line, semitones), chords: isChordLine(line) }))

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

export const pixelsPerTick = (speed: number): number => clamped(speed) / 10

export const MOST_SEMITONES = 11

export const shifted = (semitones: number, by: number): number =>
  Math.min(MOST_SEMITONES, Math.max(-MOST_SEMITONES, semitones + by))
