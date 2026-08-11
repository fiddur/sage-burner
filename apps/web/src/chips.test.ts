import { describe, expect, it } from 'vitest'

import { isLit, litAfterTap } from './chips.ts'

const ALL = ['burns', 'dreams', 'posts', 'people'] as const

describe('tapping a chip', () => {
  it('solos it when everything is lit, which is the flood case in one tap', () => {
    expect(litAfterTap(ALL, [], 'dreams')).toEqual(['dreams'])
  })

  it('lights another one from a filtered state', () => {
    expect(litAfterTap(ALL, ['dreams'], 'posts')).toEqual(['dreams', 'posts'])
  })

  it('puts one out from a filtered state, which is the hide-the-flood case in one tap', () => {
    expect(litAfterTap(ALL, ['dreams', 'posts'], 'dreams')).toEqual(['posts'])
  })

  it('goes back to everything rather than to nothing when the last one goes out', () => {
    expect(litAfterTap(ALL, ['dreams'], 'dreams')).toEqual([])
  })

  it('says everything the one way once every chip is lit, so two spellings cannot both mean it', () => {
    expect(litAfterTap(ALL, ['burns', 'dreams', 'posts'], 'people')).toEqual([])
  })
})

describe('whether a chip shows as lit', () => {
  it('lights every chip when nothing is filtered', () => {
    for (const chip of ALL) expect(isLit([], chip)).toBe(true)
  })

  it('lights only what is asked for once something is', () => {
    expect(isLit(['dreams'], 'dreams')).toBe(true)
    expect(isLit(['dreams'], 'posts')).toBe(false)
  })
})
