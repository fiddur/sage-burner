import { randomUUID } from 'node:crypto'

/**
 * The login address, as a way of being reached, for an account being created.
 *
 * Every account has one, and a list that starts empty is a list nobody fills in — so this
 * is seeded rather than waited for. An ordinary row from here: sortable, editable, and
 * removable by the person whose it is, because present by default is not the same as
 * imposed.
 *
 * It publishes the login address to members. Usually that address is already on the roster
 * through `account.contact`, which `redemption.ts` defaults to it — but `contact` is editable,
 * so for anybody who replaced it this is the first time their login address is shown. The
 * migration that backfilled existing accounts says why that was accepted rather than scoped
 * around.
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
