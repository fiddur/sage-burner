import { describe, expect, it } from 'vitest'

import {
  columnsFitting,
  DEFAULT_SPEED,
  MAX_SPEED,
  MIN_SPEED,
  MOST_SEMITONES,
  rememberedSpeed,
  rememberSpeed,
  scrollStep,
  shifted,
  songRows,
  SPEED_KEY,
  wrappedRows,
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
  it('takes a chord line and the words under it as one row', () => {
    expect(songRows('Am   F\ncome and sing')).toEqual([{ chords: 'Am   F', words: 'come and sing' }])
  })

  it('leaves a chord line with nothing under it a row of its own', () => {
    expect(songRows('Am   F\n\nAm')).toEqual([
      { chords: 'Am   F', words: null },
      { chords: null, words: '' },
      { chords: 'Am', words: null },
    ])
  })

  it('keeps the blank lines, since a verse break is part of the words', () => {
    expect(songRows('come and sing\n\nsing again')).toEqual([
      { chords: null, words: 'come and sing' },
      { chords: null, words: '' },
      { chords: null, words: 'sing again' },
    ])
  })

  it('transposes only what it marked as chords', () => {
    expect(songRows('Am   F\nA change is coming', 2)).toEqual([
      { chords: 'Bm   G', words: 'A change is coming' },
    ])
  })
})

describe('wrapping a row too wide for the page', () => {
  const LINE = {
    chords: 'C             D                     G                        Em',
    words: '   No longer lend you strength to that which you wish to be free from',
  }

  it('leaves a row that fits where it is', () => {
    expect(wrappedRows([LINE], 80)).toEqual([LINE])
  })

  it('breaks the pair at one column, so the chords stay above their syllables', () => {
    expect(wrappedRows([LINE], 40)).toEqual([
      { chords: 'C             D                     G', words: '   No longer lend you strength to that' },
      { chords: '                      Em', words: 'which you wish to be free from' },
    ])
  })

  it('sends a chord standing over a gap along with the words it heads', () => {
    expect(wrappedRows([{ chords: '  Am   Em    C', words: 'for  a     while' }], 10)).toEqual([
      { chords: '  Am', words: 'for  a' },
      { chords: 'Em    C', words: '    while' },
    ])
  })

  it('drops the chord line off a continuation with no chords on it, which would read as a verse break', () => {
    expect(
      wrappedRows([{ chords: '   Am', words: 'a longer line of words that has to break somewhere' }], 30),
    ).toEqual([
      { chords: '   Am', words: 'a longer line of words that' },
      { chords: null, words: 'has to break somewhere' },
    ])
  })

  it('drops the words line off a continuation whose words have run out, the mirror of the chord rule', () => {
    expect(wrappedRows([{ chords: 'C  G  Am  F', words: 'hey' }], 6)).toEqual([
      { chords: 'C  G', words: 'hey' },
      { chords: 'Am  F', words: null },
    ])
  })

  it('breaks a line of words with no chords over it at a space', () => {
    expect(wrappedRows([{ chords: null, words: 'come and sing with me' }], 12)).toEqual([
      { chords: null, words: 'come and' },
      { chords: null, words: 'sing with me' },
    ])
  })

  it('breaks a chord line with no words under it, which has no syllables to hold', () => {
    expect(wrappedRows([{ chords: 'Am   F   C   G', words: null }], 8)).toEqual([
      { chords: 'Am   F', words: null },
      { chords: 'C   G', words: null },
    ])
  })

  it('lets a word longer than the page overflow rather than looping on it', () => {
    expect(wrappedRows([{ chords: null, words: 'antidisestablishmentarianism' }], 10)).toEqual([
      { chords: null, words: 'antidisestablishmentarianism' },
    ])
  })

  it('wraps nothing until something has measured the width', () => {
    expect(wrappedRows([LINE], Number.POSITIVE_INFINITY)).toEqual([LINE])
    expect(wrappedRows([LINE], 0)).toEqual([LINE])
  })
})

describe('a row that fits as it is', () => {
  it('keeps a blank line blank, since a verse break is part of the words', () => {
    expect(wrappedRows([{ chords: null, words: '' }], 40)).toEqual([{ chords: null, words: '' }])
  })
})

describe('how many characters fit across the page', () => {
  it('counts whole characters into the measured width', () => {
    expect(columnsFitting(320, 8)).toBe(40)
    expect(columnsFitting(323, 8)).toBe(40)
  })

  it('answers that everything fits when nothing has been measured', () => {
    expect(columnsFitting(0, 0)).toBe(Number.POSITIVE_INFINITY)
    expect(columnsFitting(320, 0)).toBe(Number.POSITIVE_INFINITY)
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
})

describe('how far one tick of the scroll moves', () => {
  const after = (ticks: number, speed: number): number => {
    let tenths = 0
    let moved = 0

    for (let tick = 0; tick < ticks; tick += 1) {
      const step = scrollStep(tenths, speed)
      tenths = step.tenths
      moved += step.move
    }

    return moved
  }

  it('carries the tenths it could not spend, since a browser throws a part pixel away', () => {
    expect(scrollStep(0, MIN_SPEED)).toEqual({ move: 0, tenths: 1 })
    expect(after(9, MIN_SPEED)).toBe(0)
    expect(after(10, MIN_SPEED)).toBe(1)
  })

  it('moves whole pixels at every speed, and the faster ones further', () => {
    expect(after(100, MIN_SPEED)).toBe(10)
    expect(after(100, DEFAULT_SPEED)).toBe(60)
    expect(after(100, MAX_SPEED)).toBe(200)
  })

  it('clamps a hand-edited speed rather than standing still or bolting', () => {
    expect(after(10, 900)).toBe(20)
    expect(after(10, -4)).toBe(1)
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
