import { describe, expect, it } from 'vitest'

import { placesIn, withPlaces } from './roster.ts'

const at = (joined_at: string, payment_status: 'unpaid' | 'paid' = 'unpaid', account_id = joined_at) => ({
  account_id,
  joined_at,
  payment_status,
})

const order = (entries: ReturnType<typeof at>[], cap: number) =>
  withPlaces(entries, cap).map((entry) => `${entry.joined_at}${entry.waiting ? ' (waiting)' : ''}`)

describe('withPlaces', () => {
  it('orders by joining while nobody has paid', () => {
    expect(order([at('3rd'), at('1st'), at('2nd')], 10)).toEqual(['1st', '2nd', '3rd'])
  })

  it('puts anyone who has paid above everyone who has not', () => {
    expect(order([at('1st'), at('2nd', 'paid')], 10)).toEqual(['2nd', '1st'])
  })

  it('keeps joining order within each group', () => {
    const entries = [at('4th'), at('2nd', 'paid'), at('3rd'), at('1st', 'paid')]

    expect(order(entries, 10)).toEqual(['1st', '2nd', '3rd', '4th'])
  })

  it('marks everyone past the cap as waiting', () => {
    expect(order([at('1st'), at('2nd'), at('3rd')], 2)).toEqual(['1st', '2nd', '3rd (waiting)'])
  })

  it('pushes an unpaid member onto the waiting list when someone else pays', () => {
    const before = [at('1st'), at('2nd'), at('3rd')]
    expect(order(before, 2)).toEqual(['1st', '2nd', '3rd (waiting)'])

    const after = [at('1st'), at('2nd'), at('3rd', 'paid')]
    expect(order(after, 2)).toEqual(['3rd', '1st', '2nd (waiting)'])
  })

  it('leaves the caller’s array alone', () => {
    const entries = [at('2nd'), at('1st')]
    withPlaces(entries, 10)

    expect(entries.map((entry) => entry.joined_at)).toEqual(['2nd', '1st'])
  })

  it('has nobody waiting when the cap is not reached', () => {
    expect(withPlaces([at('1st'), at('2nd')], 42).every((entry) => !entry.waiting)).toBe(true)
  })

  it('handles an empty burn', () => {
    expect(withPlaces([], 42)).toEqual([])
  })

  it('breaks a tie on the account, so the line falls in the same place on every read (#506)', () => {
    const rows = [at('same', 'unpaid', 'c'), at('same', 'unpaid', 'a'), at('same', 'unpaid', 'b')]

    expect(withPlaces(rows, 2).map((entry) => `${entry.account_id}${entry.waiting ? '!' : ''}`)).toEqual([
      'a',
      'b',
      'c!',
    ])
    expect(withPlaces([...rows].reverse(), 2).map((entry) => entry.account_id)).toEqual(['a', 'b', 'c'])
  })
})

describe('placesIn', () => {
  it('counts a place taken by whoever holds it, paid or not', () => {
    expect(placesIn([at('1st')], 1)).toEqual({ taken: 1, left: 0, waiting: 0 })
  })

  it('agrees with withPlaces about who is not waiting, which is the whole point', () => {
    const entries = [at('1st'), at('2nd'), at('3rd', 'paid'), at('4th')]

    for (const cap of [0, 1, 2, 3, 4, 5]) {
      expect(placesIn(entries, cap).taken).toBe(withPlaces(entries, cap).filter((one) => !one.waiting).length)
      expect(placesIn(entries, cap).waiting).toBe(
        withPlaces(entries, cap).filter((one) => one.waiting).length,
      )
    }
  })

  it('leaves the places nobody is standing in', () => {
    expect(placesIn([at('1st')], 4)).toEqual({ taken: 1, left: 3, waiting: 0 })
  })

  it('never reports a negative remainder on an over-subscribed burn', () => {
    expect(placesIn([at('1st'), at('2nd'), at('3rd')], 1)).toEqual({ taken: 1, left: 0, waiting: 2 })
  })

  it('holds an empty burn open', () => {
    expect(placesIn([], 42)).toEqual({ taken: 0, left: 42, waiting: 0 })
  })
})
