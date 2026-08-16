import { afterEach, describe, expect, it, vi } from 'vitest'

import { rememberSidebar, SIDEBAR_HIDDEN_KEY, sidebarHidden } from './sidebar.ts'

afterEach(() => {
  vi.restoreAllMocks()
  globalThis.localStorage.clear()
})

const blocked: Storage = {
  length: 0,
  clear: () => {
    throw new Error('denied')
  },
  getItem: () => {
    throw new Error('denied')
  },
  key: () => {
    throw new Error('denied')
  },
  removeItem: () => {
    throw new Error('denied')
  },
  setItem: () => {
    throw new Error('denied')
  },
}

describe('whether the sidebar was put away', () => {
  it('reads the key it wrote', () => {
    rememberSidebar(true)

    expect(sidebarHidden()).toBe(true)
  })

  it('clears the key rather than writing a second value, so the two cannot disagree', () => {
    rememberSidebar(true)
    rememberSidebar(false)

    expect(sidebarHidden()).toBe(false)
    expect(globalThis.localStorage.getItem(SIDEBAR_HIDDEN_KEY)).toBeNull()
  })

  it('says shown rather than throwing when reading the property itself throws', () => {
    // Chromium with site data blocked for the origin, and Brave's "block all cookies":
    // `globalThis.localStorage` is a *getter* that throws `SecurityError`. This is read in
    // `useSidebar`'s state initialiser, during render, with no error boundary above it.
    vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('SecurityError')
    })

    expect(sidebarHidden()).toBe(false)
    expect(() => rememberSidebar(true)).not.toThrow()
  })

  it('says shown rather than throwing where the storage itself refuses', () => {
    vi.spyOn(globalThis, 'localStorage', 'get').mockReturnValue(blocked)

    expect(sidebarHidden()).toBe(false)
    expect(() => rememberSidebar(true)).not.toThrow()
    expect(() => rememberSidebar(false)).not.toThrow()
  })

  it('says shown where there is no storage at all, rather than reading absence as hidden', () => {
    vi.spyOn(globalThis, 'localStorage', 'get').mockReturnValue(undefined as unknown as Storage)

    expect(sidebarHidden()).toBe(false)
    expect(() => rememberSidebar(true)).not.toThrow()
  })
})
