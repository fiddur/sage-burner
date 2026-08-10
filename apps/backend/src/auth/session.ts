import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export interface SessionPayload {
  account_id: string
}

export interface SessionDeps {
  secret: string
  now: () => Date
  ttlSeconds: number
}

const MIN_SECRET_LENGTH = 32

interface WireFormat {
  sub: string
  exp: number
  jti: string
}

const isWireFormat = (value: unknown): value is Pick<WireFormat, 'sub' | 'exp'> =>
  typeof value === 'object' &&
  value !== null &&
  'sub' in value &&
  typeof value.sub === 'string' &&
  'exp' in value &&
  typeof value.exp === 'number' &&
  Number.isFinite(value.exp)

export interface Sessions {
  issue: (accountId: string) => string
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

      const expected = Buffer.from(signatureFor(encoded), 'utf8')
      const actual = Buffer.from(signature, 'utf8')
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return undefined

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
