import { describe, expect, it } from 'vitest'

import { allergiesOf } from './allergies.ts'

describe('allergiesOf', () => {
  it('puts the ticked items and the free text in one line', () => {
    expect(allergiesOf({ allergy_items: ['Vegan'], allergies_notes: 'red lentils' })).toBe(
      'Vegan, red lentils',
    )
  })

  it('shows the ticks alone when nothing was written', () => {
    expect(allergiesOf({ allergy_items: ['Lactose'], allergies_notes: null })).toBe('Lactose')
  })

  it('shows the free text alone for somebody who ticked nothing', () => {
    expect(allergiesOf({ allergy_items: [], allergies_notes: 'peanuts' })).toBe('peanuts')
  })

  it('shows a dash when there is neither, rather than an empty cell', () => {
    expect(allergiesOf({ allergy_items: [], allergies_notes: null })).toBe('—')
  })
})
