import { describe, expect, it } from 'vitest'

import { whereItBelongs } from './cards.ts'

describe('whereItBelongs', () => {
  it('is the burn a card was made on', () => {
    expect(whereItBelongs({ burn: 'Boundary Burn', entity_type: 'role' })).toBe('Boundary Burn')
  })

  it('calls the songbook by its name, a song belonging to no burn', () => {
    expect(whereItBelongs({ burn: null, entity_type: 'song' })).toBe('Songbook')
  })

  it('says nothing of a card that belongs nowhere and is not a song', () => {
    expect(whereItBelongs({ burn: null, entity_type: 'post' })).toBeUndefined()
  })

  it('prefers the burn even on a song, which a burn-scoped one would have', () => {
    expect(whereItBelongs({ burn: 'Boundary Burn', entity_type: 'song' })).toBe('Boundary Burn')
  })
})
