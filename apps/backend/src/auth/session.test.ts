import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { createSessions } from './session.ts'

/**
 * Sessions are a signed value, not a database row, so these are pure: an
 * injected secret and an injected clock, no HTTP and no storage.
 */

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
    // Without the nonce, a token would be a pure function of account and
    // issue-time — two logins in the same second would produce the same string,
    // and logging one would leak the other.
    const auth = sessions()

    expect(auth.issue('acct-1')).not.toBe(auth.issue('acct-1'))
  })

  it('keeps the account id inside the signed payload', () => {
    // Narrower than it looks, and worth being exact about: the payload is
    // base64url JSON, so a token in a log line *does* leak the id —
    // `Buffer.from(part, 'base64url')` is the whole attack. What this pins is
    // only that the id lives inside the signed blob rather than in a separate
    // plaintext field beside it, where an unrelated log line could pick it up
    // without the token.
    //
    // The thing that keeps tokens out of logs is the `redact` list in `app.ts`,
    // tested there.
    const token = sessions().issue('acct-secret-1234')

    expect(token).not.toContain('acct-secret-1234')
    // Stated rather than implied: it decodes.
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
    // The whole point of signing: swapping in another account id must fail
    // rather than silently authenticating as that account.
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
    // Pins which side of the boundary is inclusive, so a refactor cannot log
    // everyone out an hour early without failing.
    const token = sessions({ now: at('2026-07-29T12:00:00.000Z'), ttlSeconds: 3600 }).issue('acct-1')

    expect(sessions({ now: at('2026-07-29T12:59:59.000Z'), ttlSeconds: 3600 }).read(token)).toEqual({
      account_id: 'acct-1',
    })
  })

  it('rejects a token whose expiry is absent or unparseable', () => {
    // A signed token with a broken payload is ours, so it would be tempting to
    // trust it. It must still fail closed rather than become non-expiring.
    //
    // The signature is built here rather than through a `sign` method on
    // `Sessions`: every route handler holds that object, and widening a
    // signing primitive's surface for one assertion is the wrong trade on the
    // one type where narrow matters most.
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
    // Guards the helper: if `signedWith` produced a signature the reader
    // rejected for the wrong reason, every case above would pass for that
    // reason instead of for its payload.
    const encoded = Buffer.from(JSON.stringify({ sub: 'acct-1', exp: 4102444800, jti: 'x' })).toString(
      'base64url',
    )
    const token = `${encoded}.${createHmac('sha256', secret).update(encoded).digest('base64url')}`

    expect(sessions().read(token)).toEqual({ account_id: 'acct-1' })
  })
})

describe('createSessions', () => {
  it('refuses a secret too short to be worth signing with', () => {
    // A deployment that sets SESSION_SECRET=changeme must fail at boot, not
    // issue forgeable sessions quietly.
    expect(() =>
      createSessions({ secret: 'short', now: at('2026-07-29T12:00:00.000Z'), ttlSeconds: 60 }),
    ).toThrow(/32/)
  })
})
