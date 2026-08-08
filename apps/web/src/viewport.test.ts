import { act, renderHook } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'

import { onADesktop, onAPhone } from './testing/viewport.ts'
import { usePhone } from './viewport.ts'

afterEach(onADesktop)

describe('usePhone', () => {
  it('says no on a wide viewport', () => {
    onADesktop()

    expect(renderHook(() => usePhone()).result.current).toBe(false)
  })

  it('says yes on a narrow one', () => {
    onAPhone()

    expect(renderHook(() => usePhone()).result.current).toBe(true)
  })

  it('changes its mind when the window does', async () => {
    // A rotation, and the case the listener exists for: without it the app keeps the
    // layout it was opened in until something else re-renders it.
    onADesktop()
    const { result } = renderHook(() => usePhone())
    expect(result.current).toBe(false)

    // Inside `act`: the listener sets state from outside a render, so without it the
    // rerender is still queued when the assertion runs.
    await act(() => onAPhone())

    expect(result.current).toBe(true)
  })

  it('answers "not a phone" where the browser cannot say', () => {
    // The layout everything worked in before, which is the safe half to fall back to:
    // a bottom bar nobody asked for is worse than a header that has to wrap.
    const held = globalThis.matchMedia
    Reflect.deleteProperty(globalThis, 'matchMedia')

    try {
      expect(renderHook(() => usePhone()).result.current).toBe(false)
    } finally {
      globalThis.matchMedia = held
    }
  })
})
