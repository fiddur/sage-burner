import { randomUUID } from 'node:crypto'

export const loginAddressConnection = (accountId: string, email: string) => ({
  id: randomUUID(),
  account_id: accountId,
  kind: 'email' as const,
  value: email,
  label: '',
  order: 0,
})
