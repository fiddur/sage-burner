import { cleanup, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { VersionApi } from '../version.ts'

import { CHECK_EVERY_MS } from '../version.ts'
import { NewVersion } from './NewVersion.tsx'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

/**
 * The bar that says this tab is running code the server no longer serves.
 *
 * The clock is faked rather than the watcher stubbed: `watchForNewVersion` polls on an
 * interval with a floor on how often it asks, and vitest's fake timers move `Date.now`
 * with the interval, so this exercises the real watcher the component wires up.
 */
const changing = () => {
  const getVersion = vi
    .fn<VersionApi['getVersion']>()
    .mockResolvedValueOnce({ build_sha: 'first' })
    .mockResolvedValue({ build_sha: 'second' })

  return { getVersion } satisfies VersionApi
}

describe('the redeploy bar', () => {
  it('says nothing while the server is on the build this page loaded', async () => {
    vi.useFakeTimers()
    const api = { getVersion: () => Promise.resolve({ build_sha: 'same' }) } satisfies VersionApi
    render(<NewVersion api={api} />)

    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS * 2)

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('offers a reload and what changed, once the build moves', async () => {
    // Both, not one: a reload throws away whatever is half-typed, and the changelog is
    // the thing worth reading before deciding to lose it (#325).
    vi.useFakeTimers()
    render(<NewVersion api={changing()} />)

    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS * 2)

    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /new/ }).getAttribute('href')).toBe('/changelog')
  })
})
