import type { ConnectionKind, OAuthProvider } from '@sage-burner/shared'

import {
  connectionKindInfo,
  connectionValue,
  MAX_CONNECTION_VALUE,
  MAX_CONNECTIONS,
} from '@sage-burner/shared'
import { randomUUID } from 'node:crypto'

export const loginAddressConnection = (accountId: string, email: string) => ({
  id: randomUUID(),
  account_id: accountId,
  kind: 'email' as const,
  value: email,
  label: '',
  order: 0,
})

export const providerConnection = (
  accountId: string,
  provider: OAuthProvider,
  reach: { kind: ConnectionKind; value: string },
  held: readonly { kind: ConnectionKind; order: number }[],
) => {
  // A labelled kind needs one, and `connectionCreateSchema` refuses an empty one — so a row
  // written with `label: ''` would be a row the member could not save an edit to.
  if (connectionKindInfo[reach.kind].labelled) return undefined

  const value = connectionValue(reach.kind, reach.value)
  if (value === '' || value.length > MAX_CONNECTION_VALUE) return undefined
  if (held.length >= MAX_CONNECTIONS) return undefined
  if (held.some((row) => row.kind === reach.kind)) return undefined

  return {
    id: randomUUID(),
    account_id: accountId,
    kind: reach.kind,
    value,
    label: '',
    order: Math.max(0, ...held.map((row) => row.order + 1)),
    from_provider: provider,
  }
}
