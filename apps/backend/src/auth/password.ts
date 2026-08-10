import type { ScryptOptions } from 'node:crypto'

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

const scryptAsync = (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (error, key) => {
      if (error) reject(error)
      else resolve(key)
    })
  })

export interface ScryptParams {
  cost: number
  blockSize: number
  parallelism: number
}

export const defaultScryptParams: ScryptParams = { cost: 2 ** 16, blockSize: 8, parallelism: 2 }

const KEY_LENGTH = 64
const SALT_LENGTH = 16

// 256, not the quoted `128 * N * r`: OpenSSL wants 4 KiB more than that at cost 2^16, and the
// 32 MiB floor hides it from every test, which hashes at `fast`. Halving it throws
// ERR_CRYPTO_INVALID_SCRYPT_PARAMS on every production login while CI stays green.
const maxmemFor = ({ cost, blockSize }: ScryptParams) => Math.max(32 * 1024 * 1024, 256 * cost * blockSize)

const derive = async (password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> => {
  return scryptAsync(password.normalize('NFC'), salt, KEY_LENGTH, {
    N: params.cost,
    r: params.blockSize,
    p: params.parallelism,
    maxmem: maxmemFor(params),
  })
}

export const hashPassword = async (password: string, params = defaultScryptParams): Promise<string> => {
  const salt = randomBytes(SALT_LENGTH)
  const key = await derive(password, salt, params)

  return `$scrypt$n=${params.cost},r=${params.blockSize},p=${params.parallelism}$${salt.toString('base64url')}$${key.toString('base64url')}`
}

interface ParsedHash {
  params: ScryptParams
  salt: Buffer
  key: Buffer
}

const parseHash = (stored: string): ParsedHash | undefined => {
  const match = /^\$scrypt\$n=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(stored)
  if (match === null) return undefined

  const [, cost, blockSize, parallelism, salt, key] = match
  if (cost === undefined || blockSize === undefined || parallelism === undefined) return undefined
  if (salt === undefined || key === undefined) return undefined

  return {
    params: { cost: Number(cost), blockSize: Number(blockSize), parallelism: Number(parallelism) },
    salt: Buffer.from(salt, 'base64url'),
    key: Buffer.from(key, 'base64url'),
  }
}

const DECOY_SALT = Buffer.alloc(SALT_LENGTH, 0x5a)

export interface VerifyOptions {
  params?: ScryptParams
  onError?: (error: unknown) => void
}

export const verifyPassword = async (
  password: string,
  stored: string | null,
  { params = defaultScryptParams, onError }: VerifyOptions = {},
): Promise<boolean> => {
  const parsed = stored === null ? undefined : parseHash(stored)

  if (parsed === undefined) {
    await derive(password, DECOY_SALT, params).catch((error: unknown) => {
      onError?.(error)
    })
    return false
  }

  try {
    const candidate = await derive(password, parsed.salt, parsed.params)
    return candidate.length === parsed.key.length && timingSafeEqual(candidate, parsed.key)
  } catch (error) {
    onError?.(error)
    return false
  }
}

export const needsRehash = (stored: string, params = defaultScryptParams): boolean => {
  const parsed = parseHash(stored)
  if (parsed === undefined) return true

  const axes = [
    [parsed.params.cost, params.cost],
    [parsed.params.blockSize, params.blockSize],
    [parsed.params.parallelism, params.parallelism],
  ] as const

  if (axes.some(([storedValue, current]) => storedValue > current)) return false

  return axes.some(([storedValue, current]) => storedValue < current)
}
