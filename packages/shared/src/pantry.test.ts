import { describe, expect, it } from 'vitest'

import { bySpot, spotIn, whereSaid } from './pantry.ts'

const at = (name: string, spot: string, place_id = name.toLowerCase()) => ({ place_id, name, spot })

describe('saying where a thing lives', () => {
  it('names the room and the box, rooms apart by a middot', () => {
    expect(whereSaid([at('Cellar', 'C'), at('Hallway', 'bucket')])).toBe('Cellar C · Hallway bucket')
  })

  it('names a room alone where no box was written, since the room is the answer', () => {
    expect(whereSaid([at('Kitchen', ''), at('Cellar', 'R2')])).toBe('Kitchen · Cellar R2')
  })

  it('is nothing at all for a thing nobody has placed', () => {
    expect(whereSaid([])).toBe('')
  })

  it('ignores the spaces around a box', () => {
    expect(whereSaid([at('Cellar', '  C  ')])).toBe('Cellar C')
  })
})

describe('finding a thing in one room', () => {
  const places = [at('Cellar', 'C', 'cellar-id'), at('Kitchen', '', 'kitchen-id')]

  it('gives the box it is in', () => {
    expect(spotIn(places, 'cellar-id')).toBe('C')
  })

  it('gives the empty box where the thing is in the room at no particular box', () => {
    expect(spotIn(places, 'kitchen-id')).toBe('')
  })

  it('gives nothing where the thing is not in that room at all', () => {
    expect(spotIn(places, 'hallway-id')).toBeUndefined()
  })
})

describe('walking a room box by box', () => {
  const sorted = (spots: readonly (readonly [string, string])[]) =>
    [...spots]
      .map(([spot, name]) => ({ spot, name }))
      .sort(bySpot)
      .map((one) => one.spot)

  it('reads the letters in order', () => {
    expect(
      sorted([
        ['C', 'Rice'],
        ['B', 'Oats'],
      ]),
    ).toEqual(['B', 'C'])
  })

  it('counts the numbers rather than spelling them, so R2 comes before R10', () => {
    expect(
      sorted([
        ['R10', 'Rice'],
        ['R2', 'Oats'],
        ['R3', 'Salt'],
      ]),
    ).toEqual(['R2', 'R3', 'R10'])
  })

  it('leaves the boxless things last, since they are what the walk cannot find', () => {
    expect(
      sorted([
        ['', 'Rice'],
        ['A', 'Oats'],
        ['', 'Salt'],
      ]),
    ).toEqual(['A', '', ''])
  })

  it('does not care about capitals', () => {
    expect(
      sorted([
        ['b', 'Rice'],
        ['A', 'Oats'],
      ]),
    ).toEqual(['A', 'b'])
  })

  it('falls back to the name where two things share a box', () => {
    expect(
      [
        { spot: 'C', name: 'Rice' },
        { spot: 'C', name: 'Oats' },
      ]
        .sort(bySpot)
        .map((one) => one.name),
    ).toEqual(['Oats', 'Rice'])
  })

  it('names the boxless in order too', () => {
    expect(
      [
        { spot: '', name: 'Rice' },
        { spot: '', name: 'Oats' },
      ]
        .sort(bySpot)
        .map((one) => one.name),
    ).toEqual(['Oats', 'Rice'])
  })

  it('reads a number on its own as a number', () => {
    expect(
      sorted([
        ['10', 'Rice'],
        ['9', 'Oats'],
      ]),
    ).toEqual(['9', '10'])
  })

  it('puts a numbered box before a lettered one, so the shelves come before the corners', () => {
    expect(
      sorted([
        ['left', 'Rice'],
        ['2', 'Oats'],
      ]),
    ).toEqual(['2', 'left'])
  })

  it('reads the second half of a box name where the first halves agree', () => {
    expect(
      sorted([
        ['R2 back', 'Rice'],
        ['R2 a', 'Oats'],
      ]),
    ).toEqual(['R2 a', 'R2 back'])
  })

  it('takes the shorter box name first where one is the start of the other', () => {
    expect(
      sorted([
        ['R2 back', 'Rice'],
        ['R2', 'Oats'],
      ]),
    ).toEqual(['R2', 'R2 back'])
  })
})
