import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Sessions as a signed value rather than a database row.
 *
 * The alternative — a `session` table — buys server-side revocation and costs a
 * row per login, a cleanup job, and a read on every request. It also collides
 * with the name `session` already means here: an event session, a "dream". For
 * up to 42 members on one small container, signing wins.
 *
 * The consequence is written down rather than glossed: **logout clears the
 * cookie, it does not invalidate the token**. A token copied before logout
 * stays valid until it expires. That is the accepted trade for a 14-day TTL;
 * anything that needs real revocation — a compromised account, a member
 * removed mid-burn — needs a table, and rotating `SESSION_SECRET` is the blunt
 * instrument until then, which logs everyone out at once.
 *
 * Signed, not encrypted. Everything in the payload is readable by whoever holds
 * the cookie, so it carries an account id and an expiry and nothing else.
 */

export interface SessionPayload {
  account_id: string
}

export interface SessionDeps {
  /** From `SESSION_SECRET`. At least 32 characters; the constructor enforces it. */
  secret: string
  /** Injected so tests can move time without waiting for it. */
  now: () => Date
  ttlSeconds: number
}

/** The minimum that makes an HMAC-SHA256 key worth having. */
const MIN_SECRET_LENGTH = 32

interface WireFormat {
  sub: string
  exp: number
  /** Random per issue, so two logins never produce the same token. */
  jti: string
}

/**
 * Narrowed to what `read` actually uses.
 *
 * Not `value is WireFormat`: that interface also requires `jti`, which nothing
 * here checks, so the guard would be claiming more than it verifies — the soft
 * cast the typing rule is aimed at. `jti` exists to make two tokens issued in
 * the same second differ; it is written, never read.
 */
const isWireFormat = (value: unknown): value is Pick<WireFormat, 'sub' | 'exp'> =>
  typeof value === 'object' &&
  value !== null &&
  'sub' in value &&
  typeof value.sub === 'string' &&
  'exp' in value &&
  typeof value.exp === 'number' &&
  Number.isFinite(value.exp)

export interface Sessions {
  /** A token for this account, expiring `ttlSeconds` from now. */
  issue: (accountId: string) => string
  /** The payload, or undefined for anything forged, malformed or expired. */
  read: (token: string) => SessionPayload | undefined
}

export const createSessions = ({ secret, now, ttlSeconds }: SessionDeps): Sessions => {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters, got ${secret.length}`)
  }

  const signatureFor = (payload: string) => createHmac('sha256', secret).update(payload).digest('base64url')

  const sign = (payload: string) => {
    const encoded = Buffer.from(payload, 'utf8').toString('base64url')
    return `${encoded}.${signatureFor(encoded)}`
  }

  return {
    issue: (accountId) =>
      sign(
        JSON.stringify({
          sub: accountId,
          exp: Math.floor(now().getTime() / 1000) + ttlSeconds,
          jti: randomBytes(9).toString('base64url'),
        } satisfies WireFormat),
      ),

    read: (token) => {
      const parts = token.split('.')
      if (parts.length !== 2) return undefined

      const [encoded, signature] = parts
      if (encoded === undefined || signature === undefined || encoded === '' || signature === '') {
        return undefined
      }

      // Compared as buffers of equal length, since timingSafeEqual throws
      // rather than returning false when the lengths differ — and the length
      // of an attacker-supplied signature is attacker-controlled.
      const expected = Buffer.from(signatureFor(encoded), 'utf8')
      const actual = Buffer.from(signature, 'utf8')
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return undefined

      // Past this line the payload is ours, which is exactly why it still gets
      // validated: a signed token with a broken payload must fail closed rather
      // than be trusted for having a good signature.
      let parsed: unknown
      try {
        parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
      } catch {
        return undefined
      }

      if (!isWireFormat(parsed)) return undefined
      if (parsed.exp * 1000 <= now().getTime()) return undefined

      return { account_id: parsed.sub }
    },
  }
}
