import { MAX_CONNECTION_VALUE, MAX_CONNECTIONS } from '@sage-burner/shared'
import { describe, expect, it } from 'vitest'

import { loginAddressConnection, providerConnection } from './connections.ts'

const reach = { kind: 'discord' as const, value: 'wren' }

const held = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ kind: 'link' as const, order: index }))

describe('the login address as a way of being reached', () => {
  it('is first in the list, since it is the only one there when an account is made', () => {
    expect(loginAddressConnection('a-1', 'wren@example.org')).toMatchObject({
      account_id: 'a-1',
      kind: 'email',
      value: 'wren@example.org',
      order: 0,
    })
  })
})

describe('the row a linked provider offers', () => {
  it('carries the provider it came from, so unlinking knows what it put there', () => {
    expect(providerConnection('a-1', 'discord', reach, [])).toMatchObject({
      account_id: 'a-1',
      kind: 'discord',
      value: 'wren',
      label: '',
      order: 0,
      from_provider: 'discord',
    })
  })

  it('goes after whatever is already listed', () => {
    expect(providerConnection('a-1', 'discord', reach, [{ kind: 'email', order: 4 }])?.order).toBe(5)
  })

  it('is nothing when a row of that kind is already listed, whatever it holds', () => {
    expect(providerConnection('a-1', 'discord', reach, [{ kind: 'discord', order: 0 }])).toBeUndefined()
  })

  it('is nothing when the list is as long as it may be', () => {
    expect(providerConnection('a-1', 'discord', reach, held(MAX_CONNECTIONS))).toBeUndefined()
  })

  it('is a row on the last place the list has room for', () => {
    expect(providerConnection('a-1', 'discord', reach, held(MAX_CONNECTIONS - 1))).toBeDefined()
  })

  it('stores what the form would have stored, so a pasted profile URL becomes a handle', () => {
    expect(
      providerConnection('a-1', 'discord', { kind: 'instagram', value: 'https://instagram.com/wren/' }, []),
    ).toMatchObject({ kind: 'instagram', value: 'wren' })
  })

  it('is nothing for a handle that is only whitespace', () => {
    expect(providerConnection('a-1', 'discord', { kind: 'discord', value: '   ' }, [])).toBeUndefined()
  })

  it('is nothing for a handle longer than the form would accept', () => {
    const value = 'w'.repeat(MAX_CONNECTION_VALUE + 1)

    expect(providerConnection('a-1', 'discord', { kind: 'discord', value }, [])).toBeUndefined()
  })

  it('takes a handle exactly as long as the form would accept', () => {
    const value = 'w'.repeat(MAX_CONNECTION_VALUE)

    expect(providerConnection('a-1', 'discord', { kind: 'discord', value }, [])).toBeDefined()
  })
})
