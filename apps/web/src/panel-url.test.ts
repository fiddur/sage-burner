import { describe, expect, it } from 'vitest'

import type { Opened } from './components/OpenedDream.tsx'

import { dreamIdOf, openedFrom, panelIsShowing } from './panel-url.ts'

const NEW_FORM: Opened = { kind: 'new', place_id: null, time_slot_start: null, time_slot_end: null }
const A_DREAM: Opened = { kind: 'dream', id: 's-1', editing: false }

describe('which dream the query names', () => {
  it('is the id of an opened dream, and nothing for the offer form', () => {
    expect(dreamIdOf(A_DREAM)).toBe('s-1')
    expect(dreamIdOf(NEW_FORM)).toBeUndefined()
    expect(dreamIdOf(undefined)).toBeUndefined()
  })
})

describe('what the query does to the panel that is open', () => {
  it('opens the dream it names', () => {
    expect(openedFrom(undefined, 's-1')).toEqual({ kind: 'dream', id: 's-1', editing: false })
  })

  it('keeps the panel it already has, so an edit in progress survives a re-read', () => {
    const editing: Opened = { kind: 'dream', id: 's-1', editing: true }

    expect(openedFrom(editing, 's-1')).toBe(editing)
  })

  it('swaps to the dream it now names', () => {
    expect(openedFrom(A_DREAM, 's-2')).toEqual({ kind: 'dream', id: 's-2', editing: false })
  })

  it('closes an opened dream when the query stops naming one', () => {
    expect(openedFrom(A_DREAM, undefined)).toBeUndefined()
  })

  it('leaves the offer form alone when the query names no dream, which is what it never does', () => {
    expect(openedFrom(NEW_FORM, undefined)).toBe(NEW_FORM)
  })
})

describe('whether a panel is actually showing', () => {
  const dreams = [{ id: 's-1' }]

  it('is true for a dream that is among them', () => {
    expect(panelIsShowing(dreams, A_DREAM)).toBe(true)
  })

  it('is false for one that is not, so the page keeps its own content', () => {
    expect(panelIsShowing(dreams, { kind: 'dream', id: 'gone', editing: false })).toBe(false)
  })

  it('is false while nothing has loaded, for the same reason', () => {
    expect(panelIsShowing([], A_DREAM)).toBe(false)
  })

  it('is false for the offer form, which stays a dialog at every width', () => {
    expect(panelIsShowing(dreams, NEW_FORM)).toBe(false)
  })

  it('is true for an opened meal whatever the dreams say', () => {
    expect(panelIsShowing([], undefined, { id: 'm-1' })).toBe(true)
  })
})
