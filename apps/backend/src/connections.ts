import { randomUUID } from 'node:crypto'

/**
 * The login address, as a way of being reached, for an account being created.
 *
 * Every account has one, and a list that starts empty is a list nobody fills in — so this
 * is seeded rather than waited for. An ordinary row from here: sortable, editable, and
 * removable by the person whose it is, because present by default is not the same as
 * imposed.
 *
 * It publishes the login address to members, which the list says it does. No new exposure:
 * `redemption.ts` has always copied that address into `account.contact`, which is on the
 * roster every approved member reads.
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
