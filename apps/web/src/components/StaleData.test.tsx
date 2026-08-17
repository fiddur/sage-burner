import { cleanup, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'

import { createFreshness, FRESH_FOR_MS } from '../freshness.ts'
import { StaleData } from './StaleData.tsx'

afterEach(cleanup)

const NOW = Date.parse('2026-08-06T12:00:00.000Z')

const shownAt = (loadedAgoMs: number | undefined) => {
  const freshness = createFreshness()
  if (loadedAgoMs !== undefined) freshness.note(NOW - loadedAgoMs)

  render(<StaleData freshness={freshness} now={() => NOW} />)

  return screen.queryByRole('status')
}

describe('saying what is on screen is old', () => {
  it('says nothing about data that has just loaded', () => {
    expect(shownAt(30_000)).toBeNull()
  })

  it('says nothing before five minutes are up', () => {
    expect(shownAt(FRESH_FOR_MS)).toBeNull()
  })

  it('speaks up once five minutes have passed', () => {
    expect(shownAt(FRESH_FOR_MS + 1000)).not.toBeNull()
  })

  it('says how old, so the reader can judge it', () => {
    const bar = shownAt(20 * 60_000)

    expect(bar?.textContent).toContain('20 minutes ago')
  })

  it('says nothing at all before anything has loaded', () => {
    expect(shownAt(undefined)).toBeNull()
  })

  it('goes away when a fetch lands, without waiting for its next tick', () => {
    const freshness = createFreshness()
    freshness.note(NOW - 20 * 60_000)

    const { rerender } = render(<StaleData freshness={freshness} now={() => NOW} />)
    expect(screen.queryByRole('status')).not.toBeNull()

    freshness.note(NOW)
    rerender(<StaleData freshness={freshness} now={() => NOW} />)

    expect(screen.queryByRole('status')).toBeNull()
  })
})
