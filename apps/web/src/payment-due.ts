export const HIDDEN_KEY = 'sage-burner:payment-due-hidden'

export const HIDDEN_FOR_MS = 24 * 60 * 60 * 1000

export type PaymentDueStore = Pick<Storage, 'getItem' | 'setItem'>

export const hiddenPaymentDue = (store: PaymentDueStore | undefined, now: Date): boolean => {
  try {
    const held = (store ?? globalThis.localStorage)?.getItem(HIDDEN_KEY)
    if (typeof held !== 'string') return false

    const since = now.getTime() - Date.parse(held)

    return since >= 0 && since < HIDDEN_FOR_MS
  } catch {
    return false
  }
}

export const hidePaymentDue = (store: PaymentDueStore | undefined, now: Date): void => {
  try {
    ;(store ?? globalThis.localStorage)?.setItem(HIDDEN_KEY, now.toISOString())
  } catch {}
}
