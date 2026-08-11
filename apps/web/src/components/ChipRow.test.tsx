import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ChipRow } from './ChipRow.tsx'

afterEach(cleanup)

const CHIPS = [
  { id: 'dreams', label: 'Dreams' },
  { id: 'posts', label: 'Posts' },
  { id: 'people', label: 'People' },
] as const

const row = (lit: readonly ('dreams' | 'posts' | 'people')[], onChange = vi.fn()) => {
  render(<ChipRow chips={CHIPS} lit={lit} subject="What to show" onChange={onChange} />)

  return onChange
}

const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed')

describe('a row of toggle chips', () => {
  it('shows everything lit until somebody says otherwise', () => {
    row([])

    expect(pressed('Everything')).toBe('true')
    for (const chip of ['Dreams', 'Posts', 'People']) expect(pressed(chip)).toBe('true')
  })

  it('puts Everything out once something is filtered, so the row says it is', () => {
    row(['dreams'])

    expect(pressed('Everything')).toBe('false')
    expect(pressed('Dreams')).toBe('true')
    expect(pressed('Posts')).toBe('false')
  })

  it('solos the chip tapped from there', () => {
    const onChange = row([])

    fireEvent.click(screen.getByRole('button', { name: 'Posts' }))

    expect(onChange).toHaveBeenCalledWith(['posts'])
  })

  it('toggles one on and off once something is filtered', () => {
    const onChange = row(['dreams'])

    fireEvent.click(screen.getByRole('button', { name: 'Posts' }))

    expect(onChange).toHaveBeenCalledWith(['dreams', 'posts'])
  })

  it('resets to everything when Everything is tapped', () => {
    const onChange = row(['dreams'])

    fireEvent.click(screen.getByRole('button', { name: 'Everything' }))

    expect(onChange).toHaveBeenCalledWith([])
  })

  it('draws nothing at all when there is nothing to filter by', () => {
    render(<ChipRow chips={[]} lit={[]} subject="What to show" onChange={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'Everything' })).toBeNull()
  })
})
