import { describe, expect, it } from 'vitest'

import {
  capoSuggestion,
  chordsIn,
  isChordLine,
  isChordToken,
  musicHost,
  parseChord,
  transposeBody,
  transposeChord,
  transposeLine,
} from './songs.ts'

describe('what parses as a chord', () => {
  it('takes a root, an accidental, a quality and a bass note', () => {
    expect(parseChord('Am')).toEqual({
      root: 'A',
      accidental: '',
      suffix: 'm',
      bass: '',
      bassAccidental: '',
    })
    expect(parseChord('F#m7')?.suffix).toBe('m7')
    expect(parseChord('C/G')?.bass).toBe('G')
    expect(parseChord('Bb')?.accidental).toBe('b')
    expect(parseChord('Dsus4')?.suffix).toBe('sus4')
    expect(parseChord('Cmaj7')?.suffix).toBe('maj7')
    expect(parseChord('Am7b5')?.suffix).toBe('m7b5')
  })

  it('refuses a word that starts with a note letter', () => {
    for (const word of ['Bad', 'Cab', 'Fade', 'Ease', 'Gone', 'Dear', 'Every']) {
      expect(parseChord(word), word).toBeUndefined()
    }
  })

  it('counts a bar line and a repeat as belonging on a chord line', () => {
    expect(isChordToken('|')).toBe(true)
    expect(isChordToken('N.C.')).toBe(true)
    expect(isChordToken('x2')).toBe(true)
    expect(isChordToken('sing')).toBe(false)
  })
})

describe('telling a chord line from words', () => {
  it('takes a line whose every token is a chord', () => {
    expect(isChordLine('Am      F      C      G')).toBe(true)
    expect(isChordLine('| Am | F | C  G |')).toBe(true)
  })

  it('leaves a line of words alone, even one naming a chord', () => {
    expect(isChordLine('and the words go here')).toBe(false)
    expect(isChordLine('Am I the one you wanted')).toBe(false)
  })

  it('needs at least one real chord, so a rule of dashes is not one', () => {
    expect(isChordLine('- - -')).toBe(false)
    expect(isChordLine('')).toBe(false)
    expect(isChordLine('   ')).toBe(false)
  })

  it('collects the chords a song is built from, chord lines only', () => {
    expect(chordsIn('Am   F\nwords about a fire\nC    G')).toEqual(['Am', 'F', 'C', 'G'])
  })
})

describe('transposing', () => {
  it('moves a chord by semitones, keeping its quality and bass', () => {
    expect(transposeChord('Am', 2)).toBe('Bm')
    expect(transposeChord('C/G', 1)).toBe('C#/G#')
    expect(transposeChord('F#m7', 1)).toBe('Gm7')
  })

  it('wraps around, and a whole octave is no move at all', () => {
    expect(transposeChord('B', 1)).toBe('C')
    expect(transposeChord('Am', 12)).toBe('Am')
    expect(transposeChord('Am', -1)).toBe('G#m')
  })

  it('spells the result with flats when the chord was written with one', () => {
    expect(transposeChord('Bb', 2)).toBe('C')
    expect(transposeChord('Bb', 1)).toBe('B')
    expect(transposeChord('Eb', 1)).toBe('E')
    expect(transposeChord('A', 1)).toBe('A#')
  })

  it('leaves anything that is not a chord as it is', () => {
    expect(transposeChord('N.C.', 2)).toBe('N.C.')
    expect(transposeChord('sing', 2)).toBe('sing')
  })

  it('holds the columns so chords stay above their words', () => {
    expect(transposeLine('Bb      F', 1)).toBe('B       F#')
    expect(transposeLine('C   G', 1)).toBe('C#  G#')
  })

  it('never closes a gap altogether, however much wider the chords get', () => {
    expect(transposeLine('C G', 1)).toBe('C# G#')
  })

  it('leaves the words alone and moves only the chord lines', () => {
    expect(transposeBody('Am  F\nwords\nC', 2)).toBe('Bm  G\nwords\nD')
  })

  it('is a no-op for a whole octave, whitespace and all', () => {
    const body = 'Am     F\nwords about a fire\n'

    expect(transposeBody(body, 12)).toBe(body)
    expect(transposeBody(body, 0)).toBe(body)
  })
})

describe('suggesting a capo', () => {
  it('offers the position that turns the chords into open shapes', () => {
    const suggestion = capoSuggestion('Bb   Eb   F\nwords')

    expect(suggestion?.capo).toBe(1)
    expect(suggestion?.shapes).toEqual(['A', 'D', 'E'])
  })

  it('offers nothing when no capo opens more shapes than none does', () => {
    expect(capoSuggestion('Am  C  G  D')).toBeUndefined()
  })

  it('offers nothing for a song with no chords in it at all', () => {
    expect(capoSuggestion('just the words, all of them')).toBeUndefined()
  })
})

describe('recognising where a link goes', () => {
  it('names the music sites it knows', () => {
    expect(musicHost('https://open.spotify.com/track/1')?.label).toBe('Spotify')
    expect(musicHost('https://youtu.be/abc')?.label).toBe('YouTube')
    expect(musicHost('https://www.youtube.com/watch?v=abc')?.label).toBe('YouTube')
    expect(musicHost('https://tabs.ultimate-guitar.com/tab/1')?.label).toBe('Ultimate Guitar')
  })

  it('says nothing about a site it does not know, or a thing that is not a link', () => {
    expect(musicHost('https://example.org/song')).toBeUndefined()
    expect(musicHost('not a link')).toBeUndefined()
    expect(musicHost('javascript:alert(1)')).toBeUndefined()
  })

  it('is not fooled by the known host appearing somewhere other than the authority', () => {
    expect(musicHost('https://evil.example/open.spotify.com')).toBeUndefined()
    expect(musicHost('https://spotify.com.evil.example/track')).toBeUndefined()
  })
})
