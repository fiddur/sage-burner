import { randomUUID } from 'node:crypto'

/**
 * The login address, as a way of being reached, for an account being created.
 *
 * Why it is seeded rather than waited for, and what publishing it costs the accounts whose
 * `contact` had been changed: "The ways somebody can be reached" in `docs/accounts.md`.
 *
 * A row rather than something synthesised on read, because it has to sort among the others
 * and a position has to be stored somewhere. `order: 0` because an account being created
 * has no other.
 */
export const loginAddressConnection = (accountId: string, email: string) => ({
  id: randomUUID(),
  account_id: accountId,
  kind: 'email' as const,
  value: email,
  label: '',
  order: 0,
})
