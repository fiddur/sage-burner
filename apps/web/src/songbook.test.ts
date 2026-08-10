import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SPEED,
  MAX_SPEED,
  MIN_SPEED,
  MOST_SEMITONES,
  pixelsPerTick,
  rememberedSpeed,
  rememberSpeed,
  shifted,
  songLines,
  SPEED_KEY,
} from './songbook.ts'

const held = (start: Record<string, string> = {}) => {
  const store = new Map(Object.entries(start))

  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    read: (key: string) => store.get(key),
  }
}

describe('laying a song out', () => {
  it('marks the chord lines and leaves the words as words', () => {
    expect(songLines('Am   F\ncome and sing')).toEqual([
      { text: 'Am   F', chords: true },
      { text: 'come and sing', chords: false },
    ])
  })

  it('keeps the blank lines, since a verse break is part of the words', () => {
    expect(songLines('Am\n\nF')).toEqual([
      { text: 'Am', chords: true },
      { text: '', chords: false },
      { text: 'F', chords: true },
    ])
  })

  it('transposes only what it marked as chords', () => {
    expect(songLines('Am   F\nA change is coming', 2)).toEqual([
      { text: 'Bm   G', chords: true },
      { text: 'A change is coming', chords: false },
    ])
  })
})

describe('the speed the phone on the floor is left at', () => {
  it('starts at a default when nothing has been said', () => {
    expect(rememberedSpeed(held())).toBe(DEFAULT_SPEED)
    expect(rememberedSpeed(undefined)).toBe(DEFAULT_SPEED)
  })

  it('reads back what was remembered', () => {
    const storage = held()
    rememberSpeed(storage, 9)

    expect(rememberedSpeed(storage)).toBe(9)
    expect(storage.read(SPEED_KEY)).toBe('9')
  })

  it('clamps whatever it finds, so a hand-edited value cannot stop the scroll', () => {
    expect(rememberedSpeed(held({ [SPEED_KEY]: '900' }))).toBe(MAX_SPEED)
    expect(rememberedSpeed(held({ [SPEED_KEY]: '-4' }))).toBe(MIN_SPEED)
    expect(rememberedSpeed(held({ [SPEED_KEY]: 'quickly' }))).toBe(DEFAULT_SPEED)
  })

  it('survives a storage that refuses, which private browsing does', () => {
    const refusing = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }

    expect(rememberedSpeed(refusing)).toBe(DEFAULT_SPEED)
    expect(() => rememberSpeed(refusing, 5)).not.toThrow()
  })

  it('turns a speed into how far one tick moves', () => {
    expect(pixelsPerTick(10)).toBe(1)
    expect(pixelsPerTick(MIN_SPEED)).toBeGreaterThan(0)
  })
})

describe('the transpose control', () => {
  it('steps up and down, and stops at an octave less a semitone', () => {
    expect(shifted(0, 1)).toBe(1)
    expect(shifted(0, -1)).toBe(-1)
    expect(shifted(MOST_SEMITONES, 1)).toBe(MOST_SEMITONES)
    expect(shifted(-MOST_SEMITONES, -1)).toBe(-MOST_SEMITONES)
  })
})
