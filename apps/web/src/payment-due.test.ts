import { describe, expect, it, vi } from 'vitest'

import { HIDDEN_KEY, hiddenPaymentDue, hidePaymentDue } from './payment-due.ts'

const aStore = (start: Record<string, string> = {}) => {
  const held = new Map(Object.entries(start))

  return {
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => {
      held.set(key, value)
    },
  }
}

const hiddenAt = new Date('2026-09-25T10:00:00Z')
const later = (ms: number) => new Date(hiddenAt.getTime() + ms)
const HOUR = 60 * 60 * 1000

describe('hiding the payment reminder for a day', () => {
  it('shows while nothing is stored', () => {
    expect(hiddenPaymentDue(aStore(), hiddenAt)).toBe(false)
  })

  it('hides right after it is hidden', () => {
    const store = aStore()

    hidePaymentDue(store, hiddenAt)

    expect(store.getItem(HIDDEN_KEY)).not.toBeNull()
    expect(hiddenPaymentDue(store, hiddenAt)).toBe(true)
  })

  it('is still hidden a minute short of a day', () => {
    const store = aStore()

    hidePaymentDue(store, hiddenAt)

    expect(hiddenPaymentDue(store, later(24 * HOUR - 60 * 1000))).toBe(true)
  })

  it('comes back once a day has passed', () => {
    const store = aStore()

    hidePaymentDue(store, hiddenAt)

    expect(hiddenPaymentDue(store, later(24 * HOUR))).toBe(false)
  })

  it('shows when what is stored is not a time', () => {
    expect(hiddenPaymentDue(aStore({ [HIDDEN_KEY]: 'yes' }), hiddenAt)).toBe(false)
  })

  it('shows when the stored time is ahead of the clock', () => {
    expect(hiddenPaymentDue(aStore({ [HIDDEN_KEY]: later(HOUR).toISOString() }), hiddenAt)).toBe(false)
  })

  it('neither throws nor hides when storage itself throws', () => {
    const throwing = {
      getItem: vi.fn(() => {
        throw new Error('SecurityError')
      }),
      setItem: vi.fn(() => {
        throw new Error('QuotaExceededError')
      }),
    }

    expect(() => hidePaymentDue(throwing, hiddenAt)).not.toThrow()
    expect(hiddenPaymentDue(throwing, hiddenAt)).toBe(false)
  })

  it('neither throws nor hides when reading localStorage throws', () => {
    const store = vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('SecurityError')
    })

    expect(() => hidePaymentDue(undefined, hiddenAt)).not.toThrow()
    expect(hiddenPaymentDue(undefined, hiddenAt)).toBe(false)

    store.mockRestore()
  })
})
