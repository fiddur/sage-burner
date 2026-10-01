import type { Meal } from '@sage-burner/shared'

import { describe, expect, it } from 'vitest'

import { mealTally } from './meal-tally.ts'

const aMeal = (over: Partial<Meal> = {}): Meal => ({
  id: 'm-1',
  event_id: 'e-1',
  date: '2026-08-01',
  at: '18:00',
  label: 'Dinner',
  kind: 'meal',
  food_idea: '',
  serves: 1,
  lead: null,
  helpers: [],
  cleanup: [],
  ingredients: [],
  ...over,
})

const ada = { account_id: 'a-1', name: 'Ada' }
const bea = { account_id: 'a-2', name: 'Bea' }

describe('mealTally', () => {
  it('counts each role somebody holds across the whole plan', () => {
    const tally = mealTally([
      aMeal({ id: 'm-1', lead: ada, cleanup: [bea] }),
      aMeal({ id: 'm-2', helpers: [ada, bea], cleanup: [ada] }),
      aMeal({ id: 'm-3', kind: 'chore', cleanup: [ada] }),
    ])

    expect(tally('a-1')).toBe('1 L · 1 H · 2 C')
    expect(tally('a-2')).toBe('0 L · 1 H · 1 C')
  })

  it('says nought for somebody on nothing', () => {
    expect(mealTally([aMeal({ lead: ada })])('a-3')).toBe('0 L · 0 H · 0 C')
  })
})
