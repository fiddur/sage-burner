import { cleanup, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AppApi } from './app.tsx'

import { FetchedViewerProvider, ViewerProvider, isAdmin, isMember, useViewer } from './viewer.tsx'

/**
 * The provider the real app uses, against an injected client.
 *
 * `app.test.tsx` always passes an explicit viewer so no render there touches
 * the network; this is the file that covers what happens when it does.
 */

afterEach(cleanup)

const Probe = () => {
  const viewer = useViewer()

  return (
    <output>
      {viewer.status}:{viewer.account?.roles.join(',') ?? '-'}
    </output>
  )
}

const renderWith = (getMe: AppApi['getMe']) =>
  render(
    <FetchedViewerProvider api={{ getMe }}>
      <Probe />
    </FetchedViewerProvider>,
  )

const state = () => screen.getByRole('status').textContent

describe('FetchedViewerProvider', () => {
  it('starts in loading rather than signed-out', () => {
    // Rendering a signed-out header and swapping it a moment later is the
    // flicker this state exists to avoid — and, once there are guarded routes,
    // the reason a member is not bounced to the login page on first paint.
    renderWith(vi.fn<AppApi['getMe']>(() => new Promise(() => undefined)))

    expect(state()).toBe('loading:-')
  })

  it('resolves to the account the API reports', async () => {
    renderWith(
      vi.fn<AppApi['getMe']>(() =>
        Promise.resolve({ viewer: { account_id: 'a-1', roles: ['admin', 'member'] } }),
      ),
    )

    await waitFor(() => expect(state()).toBe('signed-in:admin,member'))
  })

  it('resolves to signed-out for a null viewer', async () => {
    renderWith(vi.fn<AppApi['getMe']>(() => Promise.resolve({ viewer: null })))

    await waitFor(() => expect(state()).toBe('signed-out:-'))
  })

  it('treats a failed request as signed-out rather than an error', async () => {
    // What an offline first paint looks like. An error banner on the public
    // homepage would be worse than the signed-out nav.
    renderWith(vi.fn<AppApi['getMe']>(() => Promise.reject(new TypeError('Failed to fetch'))))

    await waitFor(() => expect(state()).toBe('signed-out:-'))
  })

  it('aborts the request when unmounted', async () => {
    // Otherwise a member who navigates away during the first paint gets a state
    // update on an unmounted tree.
    const signals: AbortSignal[] = []
    const getMe = vi.fn<AppApi['getMe']>((signal) => {
      if (signal !== undefined) signals.push(signal)
      return new Promise(() => undefined)
    })

    const { unmount } = renderWith(getMe)
    unmount()

    expect(signals).toHaveLength(1)
    expect(signals[0]?.aborted).toBe(true)
  })
})

describe('ViewerProvider', () => {
  const StatusProbe = () => {
    const viewer = useViewer()

    return <output>{viewer.status}</output>
  }

  it('keeps the prop live rather than seeding it once', () => {
    // `useState(viewer)` makes the prop an initial value only, which silently
    // breaks the seam a test uses to say who is looking: re-rendering with a
    // different viewer does nothing, and a test written that way passes against
    // genuinely broken code. That happened during this PR.
    const { rerender } = render(
      <ViewerProvider viewer={{ status: 'loading' }}>
        <StatusProbe />
      </ViewerProvider>,
    )
    expect(screen.getByRole('status').textContent).toBe('loading')

    rerender(
      <ViewerProvider viewer={{ status: 'signed-out' }}>
        <StatusProbe />
      </ViewerProvider>,
    )
    expect(screen.getByRole('status').textContent).toBe('signed-out')
  })
})

describe('role helpers', () => {
  const withRoles = (roles: ('admin' | 'member')[]) =>
    ({ status: 'signed-in', account: { id: 'a-1', roles } }) as const

  it('reads admin and member independently', () => {
    expect(isAdmin(withRoles(['admin']))).toBe(true)
    expect(isMember(withRoles(['admin']))).toBe(false)
    expect(isMember(withRoles(['member']))).toBe(true)
    expect(isAdmin(withRoles(['member']))).toBe(false)
    expect(isAdmin(withRoles(['admin', 'member']))).toBe(true)
    expect(isMember(withRoles(['admin', 'member']))).toBe(true)
  })

  it('is false for a signed-out or loading viewer', () => {
    // An admin route must not open during the loading frame.
    for (const status of ['signed-out', 'loading'] as const) {
      expect(isAdmin({ status })).toBe(false)
      expect(isMember({ status })).toBe(false)
    }
  })
})
