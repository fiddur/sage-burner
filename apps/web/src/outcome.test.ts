import { renderHook } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'

import { useOauthOutcome } from './outcome.ts'

const at = (url: string) => {
  window.history.replaceState(null, '', url)
}

afterEach(() => {
  at('/')
})

describe('the reason a provider round trip left in the URL', () => {
  it('is read once and then taken out, so a reload does not announce it again', async () => {
    at('/profile?from=linked')

    const { result, rerender } = renderHook(() => useOauthOutcome())

    expect(result.current.outcome).toBe('linked')
    expect(window.location.search).toBe('')
    rerender()
    expect(result.current.outcome).toBe('linked')
  })

  it('leaves the rest of the query alone', async () => {
    at('/profile?burn=e-1&from=linked&x=2')

    renderHook(() => useOauthOutcome())

    expect(new URLSearchParams(window.location.search).get('burn')).toBe('e-1')
    expect(new URLSearchParams(window.location.search).get('x')).toBe('2')
    expect(new URLSearchParams(window.location.search).get('from')).toBeNull()
  })

  it('touches nothing where there was no round trip', async () => {
    at('/profile?burn=e-1')

    const { result } = renderHook(() => useOauthOutcome())

    expect(result.current.outcome).toBeNull()
    expect(window.location.search).toBe('?burn=e-1')
  })

  it('carries the reference an organiser is asked for, and clears it too', () => {
    at('/profile?from=misconfigured&ref=req-8s')

    const { result } = renderHook(() => useOauthOutcome())

    expect(result.current).toEqual({ outcome: 'misconfigured', ref: 'req-8s' })
    expect(window.location.search).toBe('')
  })

  it('drops a reference that is not the shape the backend produces', () => {
    at('/login?from=misconfigured&ref=req-8.%20Your%20account%20needs%20confirming%20at%20evil.example')

    const { result } = renderHook(() => useOauthOutcome())

    expect(result.current.ref).toBeNull()
  })

  it('keeps a reference that is', () => {
    at('/login?from=misconfigured&ref=req-8s')

    const { result } = renderHook(() => useOauthOutcome())

    expect(result.current.ref).toBe('req-8s')
  })
})
