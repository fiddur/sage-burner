import { createHash, randomBytes } from 'node:crypto'

const INVITE_TOKEN_BYTES = 32

export const INVITE_VALID_DAYS = 30

export const digestOf = (token: string) => createHash('sha256').update(token).digest('hex')

export const mintToken = () => {
  const token = randomBytes(INVITE_TOKEN_BYTES).toString('base64url')

  return { token, token_hash: digestOf(token) }
}

export const defaultExpiry = (now: Date) =>
  new Date(now.getTime() + INVITE_VALID_DAYS * 24 * 60 * 60 * 1000).toISOString()
