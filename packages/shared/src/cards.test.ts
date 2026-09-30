import { describe, expect, it } from 'vitest'

import type { FeedRow } from './cards.ts'
import type { ThreadEntityType, ThreadEntryKind } from './enums.ts'

import { FOLD_AT, foldHead, foldRuns, whereItBelongs } from './cards.ts'

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

const rows = (
  count: number,
  entity_type: ThreadEntityType,
  prefix: string,
  last_kind: ThreadEntryKind = 'added',
): FeedRow[] =>
  Array.from({ length: count }, (_, index) => ({ id: `${prefix}${index}`, entity_type, last_kind }))

describe('foldRuns', () => {
  it('folds five of one kind in a row into one item naming them in order', () => {
    expect(foldRuns(rows(FOLD_AT, 'song', 's'))).toEqual([
      { fold: { entity_type: 'song', thread_ids: ['s0', 's1', 's2', 's3', 's4'] } },
    ])
  })

  it('leaves four of one kind in a row as four cards', () => {
    expect(foldRuns(rows(FOLD_AT - 1, 'song', 's'))).toEqual([
      { id: 's0' },
      { id: 's1' },
      { id: 's2' },
      { id: 's3' },
    ])
  })

  it('breaks a run at a card being talked about, and folds each piece only where it is long enough', () => {
    const said: FeedRow = { id: 'said', entity_type: 'song', last_kind: 'comment' }

    expect(foldRuns([...rows(FOLD_AT, 'song', 'a'), said, ...rows(FOLD_AT - 1, 'song', 'b')])).toEqual([
      { fold: { entity_type: 'song', thread_ids: ['a0', 'a1', 'a2', 'a3', 'a4'] } },
      { id: 'said' },
      { id: 'b0' },
      { id: 'b1' },
      { id: 'b2' },
      { id: 'b3' },
    ])
  })

  it('makes two folds of two kinds side by side', () => {
    expect(foldRuns([...rows(FOLD_AT, 'song', 's'), ...rows(FOLD_AT, 'session', 'd', 'offered')])).toEqual([
      { fold: { entity_type: 'song', thread_ids: ['s0', 's1', 's2', 's3', 's4'] } },
      { fold: { entity_type: 'session', thread_ids: ['d0', 'd1', 'd2', 'd3', 'd4'] } },
    ])
  })

  it('never folds announcements, however many there are in a row', () => {
    const posts = rows(FOLD_AT * 3, 'post', 'p', 'posted')

    expect(foldRuns(posts)).toEqual(posts.map((row) => ({ id: row.id })))
  })

  it('keeps the order it was given around a fold', () => {
    const before: FeedRow = { id: 'before', entity_type: 'role', last_kind: 'facilitator' }
    const after: FeedRow = { id: 'after', entity_type: 'attendance', last_kind: 'joined' }

    expect(foldRuns([before, ...rows(FOLD_AT, 'song', 's'), after])).toEqual([
      { id: 'before' },
      { fold: { entity_type: 'song', thread_ids: ['s0', 's1', 's2', 's3', 's4'] } },
      { id: 'after' },
    ])
  })

  it('answers nothing for nothing', () => {
    expect(foldRuns([])).toEqual([])
  })
})

describe('foldHead', () => {
  it('says how many and of what', () => {
    expect(foldHead('song', 14)).toBe('14 songs')
    expect(foldHead('attendance', 6)).toBe('6 people coming')
  })
})
