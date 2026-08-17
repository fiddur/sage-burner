import type { PaymentStatus } from './enums.ts'

export interface Placeable {
  account_id: string
  payment_status: PaymentStatus
  joined_at: string
}

export const byPlace = (a: Placeable, b: Placeable): number => {
  if (a.payment_status !== b.payment_status) return a.payment_status === 'paid' ? -1 : 1
  if (a.joined_at !== b.joined_at) return a.joined_at < b.joined_at ? -1 : 1

  return a.account_id < b.account_id ? -1 : a.account_id > b.account_id ? 1 : 0
}

export const withPlaces = <T extends Placeable>(entries: readonly T[], cap: number) =>
  [...entries].sort(byPlace).map((entry, index) => ({ ...entry, waiting: index >= cap }))

export interface Places {
  taken: number
  left: number
  waiting: number
}

export const placesIn = (entries: { readonly length: number }, cap: number): Places => {
  const taken = Math.min(entries.length, Math.max(0, cap))

  return { taken, left: Math.max(0, cap - taken), waiting: entries.length - taken }
}
