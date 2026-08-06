import { describe, expect, it } from 'vitest'

import { allergiesOf } from './allergies.ts'

describe('allergiesOf', () => {
  it('puts the ticked items and the free text in one line', () => {
    // Both are answers to the same question, and whoever cooks reads one column.
    expect(allergiesOf({ allergy_items: ['Vegan'], allergies_notes: 'red lentils' })).toBe(
      'Vegan, red lentils',
    )
  })

  it('shows the ticks alone when nothing was written', () => {
    expect(allergiesOf({ allergy_items: ['Lactose'], allergies_notes: null })).toBe('Lactose')
  })

  it('shows the free text alone for somebody who ticked nothing', () => {
    // The old shape, and still the common one: the list is new and the text is not.
    expect(allergiesOf({ allergy_items: [], allergies_notes: 'peanuts' })).toBe('peanuts')
  })

  it('shows a dash when there is neither, rather than an empty cell', () => {
    // An empty cell reads as a row that failed to load.
    expect(allergiesOf({ allergy_items: [], allergies_notes: null })).toBe('—')
  })
})
