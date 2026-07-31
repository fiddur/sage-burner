import type { PaymentStatus } from './enums.ts'

/**
 * Who is coming to a burn, in the order that decides who actually gets a place.
 *
 * Type-only imports, so this module pulls in no Zod and both the admin table and
 * the member-facing list can share one definition of the rule. They must agree:
 * a member told they are 12th while the organiser's list says 9th is worse than
 * either page being absent.
 */

/** The two fields the ordering depends on, and nothing else. */
export interface Placeable {
  payment_status: PaymentStatus
  joined_at: string
}

/**
 * **Paid first, then unpaid. Within each group, order of joining.**
 *
 * The consequence is the point: paying moves you above every unpaid member
 * regardless of who joined first, so an unpaid member can be pushed onto the
 * waiting list by someone else paying, without doing anything themselves. That is
 * what makes paying the thing that secures a place.
 */
export const byPlace = (a: Placeable, b: Placeable): number => {
  if (a.payment_status !== b.payment_status) return a.payment_status === 'paid' ? -1 : 1

  return a.joined_at < b.joined_at ? -1 : a.joined_at > b.joined_at ? 1 : 0
}

/**
 * The first `cap` places are confirmed; the rest are waiting.
 *
 * Derived on every read rather than stored. A `waiting` flag would go stale the
 * moment anyone paid, and the whole rule is that paying re-sorts the list.
 */
export const withPlaces = <T extends Placeable>(entries: readonly T[], cap: number) =>
  [...entries].sort(byPlace).map((entry, index) => ({ ...entry, waiting: index >= cap }))
