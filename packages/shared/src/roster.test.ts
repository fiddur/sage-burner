import { describe, expect, it } from 'vitest'

import { withPlaces } from './roster.ts'

const at = (joined_at: string, payment_status: 'unpaid' | 'paid' = 'unpaid') => ({
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
    // The rule that makes paying secure a place: it beats joining first.
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
    // Nobody did anything to the second member, and they lost their place. That
    // is intended, and it is why the list has to show where people stand.
    const before = [at('1st'), at('2nd'), at('3rd')]
    expect(order(before, 2)).toEqual(['1st', '2nd', '3rd (waiting)'])

    const after = [at('1st'), at('2nd'), at('3rd', 'paid')]
    expect(order(after, 2)).toEqual(['3rd', '1st', '2nd (waiting)'])
  })

  it('leaves the caller’s array alone', () => {
    // The pages hold this list in state; sorting in place would reorder what they
    // are already rendering.
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
})
