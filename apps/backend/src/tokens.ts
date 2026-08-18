import { createHash, randomBytes } from 'node:crypto'

const TOKEN_BYTES = 32

export const digestOf = (token: string) => createHash('sha256').update(token).digest('hex')

export const mintToken = () => {
  const token = randomBytes(TOKEN_BYTES).toString('base64url')

  return { token, token_hash: digestOf(token) }
}
