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

const SLIDE_AFTER_SECONDS = 60 * 60 * 24

interface WireFormat {
  sub: string
  exp: number
  iat: number
  jti: string
}

type Read = Pick<WireFormat, 'sub' | 'exp'> & { iat?: number }

const isWireFormat = (value: unknown): value is Read =>
  typeof value === 'object' &&
  value !== null &&
  'sub' in value &&
  typeof value.sub === 'string' &&
  'exp' in value &&
  typeof value.exp === 'number' &&
  Number.isFinite(value.exp) &&
  (!('iat' in value) || (typeof value.iat === 'number' && Number.isFinite(value.iat)))

export interface Sessions {
  issue: (accountId: string) => string
  read: (token: string) => SessionPayload | undefined
  slid: (token: string) => string | undefined
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

  const seconds = () => Math.floor(now().getTime() / 1000)

  const issue = (accountId: string) => {
    const at = seconds()

    return sign(
      JSON.stringify({
        sub: accountId,
        exp: at + ttlSeconds,
        iat: at,
        jti: randomBytes(9).toString('base64url'),
      } satisfies WireFormat),
    )
  }

  const verified = (token: string): Read | undefined => {
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

    return parsed
  }

  return {
    issue,

    read: (token) => {
      const parsed = verified(token)
      return parsed === undefined ? undefined : { account_id: parsed.sub }
    },

    slid: (token) => {
      const parsed = verified(token)
      if (parsed === undefined) return undefined

      const issuedAt = parsed.iat ?? parsed.exp - ttlSeconds
      const slack = Math.min(SLIDE_AFTER_SECONDS, Math.floor(ttlSeconds / 2))
      if (seconds() - issuedAt < slack) return undefined

      return issue(parsed.sub)
    },
  }
}
