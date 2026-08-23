import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { createSessions } from './session.ts'

const secret = 'a'.repeat(32)
const at = (iso: string) => () => new Date(iso)

const sessions = (options: { secret?: string; now?: () => Date; ttlSeconds?: number } = {}) =>
  createSessions({
    secret: options.secret ?? secret,
    now: options.now ?? at('2026-07-29T12:00:00.000Z'),
    ttlSeconds: options.ttlSeconds ?? 60 * 60 * 24 * 14,
  })

describe('issue and read', () => {
  it('round-trips the account it was issued for', () => {
    const auth = sessions()

    expect(auth.read(auth.issue('acct-1'))).toEqual({ account_id: 'acct-1' })
  })

  it('gives different tokens for the same account, so one is not a fingerprint', () => {
    const auth = sessions()

    expect(auth.issue('acct-1')).not.toBe(auth.issue('acct-1'))
  })

  it('keeps the account id inside the signed payload', () => {
    const token = sessions().issue('acct-secret-1234')

    expect(token).not.toContain('acct-secret-1234')
    const [payload = ''] = token.split('.')
    expect(Buffer.from(payload, 'base64url').toString('utf8')).toContain('acct-secret-1234')
  })
})

describe('rejection', () => {
  const cases: [string, string][] = [
    ['empty', ''],
    ['not a token', 'nonsense'],
    ['missing signature', 'eyJhIjoxfQ'],
    ['too many parts', 'a.b.c.d'],
  ]

  for (const [name, token] of cases) {
    it(`rejects a ${name} token`, () => {
      expect(sessions().read(token)).toBeUndefined()
    })
  }

  it('rejects a token signed with another secret', () => {
    const token = sessions({ secret: 'b'.repeat(32) }).issue('acct-1')

    expect(sessions().read(token)).toBeUndefined()
  })

  it('rejects a token whose payload was edited', () => {
    const auth = sessions()
    const [payload = '', signature = ''] = auth.issue('acct-1').split('.')
    const forged = Buffer.from(
      Buffer.from(payload, 'base64url').toString('utf8').replace('acct-1', 'acct-2'),
    ).toString('base64url')

    expect(auth.read(`${forged}.${signature}`)).toBeUndefined()
  })

  it('rejects an expired token', () => {
    const token = sessions({ now: at('2026-07-29T12:00:00.000Z'), ttlSeconds: 3600 }).issue('acct-1')

    expect(sessions({ now: at('2026-07-29T13:00:01.000Z'), ttlSeconds: 3600 }).read(token)).toBeUndefined()
  })

  it('accepts a token one second before it expires', () => {
    const token = sessions({ now: at('2026-07-29T12:00:00.000Z'), ttlSeconds: 3600 }).issue('acct-1')

    expect(sessions({ now: at('2026-07-29T12:59:59.000Z'), ttlSeconds: 3600 }).read(token)).toEqual({
      account_id: 'acct-1',
    })
  })

  it('rejects a token whose expiry is absent or unparseable', () => {
    const signedWith = (payload: string) => {
      const encoded = Buffer.from(payload, 'utf8').toString('base64url')
      return `${encoded}.${createHmac('sha256', secret).update(encoded).digest('base64url')}`
    }

    const auth = sessions()
    for (const payload of ['{}', '{"sub":"acct-1"}', '{"sub":"acct-1","exp":"soon"}', 'not json']) {
      expect(auth.read(signedWith(payload)), payload).toBeUndefined()
    }
  })

  it('accepts a signature this test built itself, so the cases above are real', () => {
    const encoded = Buffer.from(JSON.stringify({ sub: 'acct-1', exp: 4102444800, jti: 'x' })).toString(
      'base64url',
    )
    const token = `${encoded}.${createHmac('sha256', secret).update(encoded).digest('base64url')}`

    expect(sessions().read(token)).toEqual({ account_id: 'acct-1' })
  })
})

describe('createSessions', () => {
  it('refuses a secret too short to be worth signing with', () => {
    expect(() =>
      createSessions({ secret: 'short', now: at('2026-07-29T12:00:00.000Z'), ttlSeconds: 60 }),
    ).toThrow(/32/)
  })
})

describe('slid', () => {
  const issued = '2026-07-29T12:00:00.000Z'

  it('leaves a token younger than a day alone', () => {
    const token = sessions({ now: at(issued) }).issue('acct-1')

    expect(sessions({ now: at('2026-07-30T11:59:59.000Z') }).slid(token)).toBeUndefined()
  })

  it('renews a token a full day old, readable for the same account', () => {
    const token = sessions({ now: at(issued) }).issue('acct-1')
    const later = sessions({ now: at('2026-07-30T12:00:00.000Z') })

    const fresh = later.slid(token)

    expect(fresh).toBeDefined()
    expect(fresh).not.toBe(token)
    expect(later.read(fresh ?? '')).toEqual({ account_id: 'acct-1' })
  })

  it('pushes the expiry out from the renewal, not the original issue', () => {
    const ttlSeconds = 60 * 60 * 24 * 14
    const token = sessions({ now: at(issued), ttlSeconds }).issue('acct-1')

    const fresh = sessions({ now: at('2026-08-10T12:00:00.000Z'), ttlSeconds }).slid(token) ?? ''

    const wellPastOriginalExpiry = sessions({ now: at('2026-08-20T12:00:00.000Z'), ttlSeconds })
    expect(wellPastOriginalExpiry.read(token)).toBeUndefined()
    expect(wellPastOriginalExpiry.read(fresh)).toEqual({ account_id: 'acct-1' })
  })

  it('gives nothing for a token already expired', () => {
    const token = sessions({ now: at(issued), ttlSeconds: 3600 }).issue('acct-1')

    expect(sessions({ now: at('2026-07-29T13:00:01.000Z'), ttlSeconds: 3600 }).slid(token)).toBeUndefined()
  })

  it('gives nothing for garbage or a foreign signature', () => {
    const later = sessions({ now: at('2026-08-05T12:00:00.000Z') })
    const foreign = sessions({ secret: 'b'.repeat(32), now: at(issued) }).issue('acct-1')

    expect(later.slid('nonsense')).toBeUndefined()
    expect(later.slid(foreign)).toBeUndefined()
  })
})
