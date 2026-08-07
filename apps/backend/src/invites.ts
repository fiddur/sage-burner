import { createHash, randomBytes } from 'node:crypto'

const INVITE_TOKEN_BYTES = 32

export const INVITE_VALID_DAYS = 30

/**
 * What is stored for a token, which is never the token.
 *
 * Beside `mintToken` because the two have to agree: a lookup hashing differently
 * from the mint finds nothing, and finds it silently. Redemption spelled this out a
 * second time, which is one rename away from exactly that.
 */
export const digestOf = (token: string) => createHash('sha256').update(token).digest('hex')

/**
 * A token that has to be unguessable, and the digest that is all we keep.
 *
 * 32 CSPRNG bytes, base64url so it survives a URL untouched. Only the SHA-256
 * reaches the database, so a leaked backup hands out no invites — and the raw
 * value exists in one response and nowhere else.
 */
export const mintToken = () => {
  const token = randomBytes(INVITE_TOKEN_BYTES).toString('base64url')

  return { token, token_hash: digestOf(token) }
}

export const defaultExpiry = (now: Date) =>
  new Date(now.getTime() + INVITE_VALID_DAYS * 24 * 60 * 60 * 1000).toISOString()
