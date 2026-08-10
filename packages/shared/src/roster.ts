import type { PaymentStatus } from './enums.ts'

export interface Placeable {
  payment_status: PaymentStatus
  joined_at: string
}

export const byPlace = (a: Placeable, b: Placeable): number => {
  if (a.payment_status !== b.payment_status) return a.payment_status === 'paid' ? -1 : 1

  return a.joined_at < b.joined_at ? -1 : a.joined_at > b.joined_at ? 1 : 0
}

export const withPlaces = <T extends Placeable>(entries: readonly T[], cap: number) =>
  [...entries].sort(byPlace).map((entry, index) => ({ ...entry, waiting: index >= cap }))
