import { describe, expect, it } from 'vitest'

import { moveTo, swap } from './reorder.ts'

const IDS = ['a', 'b', 'c', 'd']

describe('swap', () => {
  it('exchanges a row with the one after or before it', () => {
    expect(swap(IDS, 1, 1)).toEqual(['a', 'c', 'b', 'd'])
    expect(swap(IDS, 2, -1)).toEqual(['a', 'c', 'b', 'd'])
  })

  it('does nothing at either end, rather than wrapping or throwing', () => {
    expect(swap(IDS, 0, -1)).toBeUndefined()
    expect(swap(IDS, IDS.length - 1, 1)).toBeUndefined()
  })

  it('does nothing for an index off the end', () => {
    expect(swap(IDS, 9, -1)).toBeUndefined()
    expect(swap([], 0, 1)).toBeUndefined()
  })

  it('leaves the list it was given alone', () => {
    const original = [...IDS]
    swap(original, 0, 1)

    expect(original).toEqual(IDS)
  })
})

describe('moveTo', () => {
  it('lifts a row out and drops it at the target', () => {
    expect(moveTo(IDS, 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveTo(IDS, 3, 0)).toEqual(['d', 'a', 'b', 'c'])
  })

  it('handles a neighbour move the same way a swap would', () => {
    expect(moveTo(IDS, 1, 2)).toEqual(swap(IDS, 1, 1))
  })

  it('does nothing when the row is dropped where it already is', () => {
    expect(moveTo(IDS, 2, 2)).toBeUndefined()
  })

  it('does nothing for an index outside the list', () => {
    expect(moveTo(IDS, -1, 1)).toBeUndefined()
    expect(moveTo(IDS, 1, -1)).toBeUndefined()
    expect(moveTo(IDS, 9, 1)).toBeUndefined()
    expect(moveTo(IDS, 1, 9)).toBeUndefined()
  })

  it('leaves the list it was given alone', () => {
    const original = [...IDS]
    moveTo(original, 0, 3)

    expect(original).toEqual(IDS)
  })

  it('keeps every id, moving one rather than dropping or duplicating it', () => {
    const moved = moveTo(IDS, 0, 3)

    expect(moved?.toSorted()).toEqual([...IDS].toSorted())
  })
})
