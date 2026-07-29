import type { ScryptOptions } from 'node:crypto'

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

/**
 * Password hashing with scrypt from `node:crypto`.
 *
 * #8 asks for argon2 or bcrypt. Both are native modules: `argon2` and
 * `@node-rs/argon2` compile against node-gyp or ship prebuilt binaries per
 * platform, and `bcrypt` is the same. That is a build toolchain inside an
 * Alpine image whose whole point is that Node 24 strips types and there is no
 * build step — and a native module is the thing most likely to break a Node
 * upgrade six months from now, on an app that has to keep running.
 *
 * scrypt is memory-hard, in the standard library, and listed by OWASP as an
 * acceptable choice where argon2id is not available. If argon2id ever becomes
 * available without a native dependency, `needsRehash` is the seam: it
 * re-hashes on the next successful login rather than invalidating every
 * account at once.
 */

/**
 * Wrapped by hand rather than with `promisify`, which resolves to the
 * three-argument overload and so rejects the options object that carries the
 * cost parameters — the whole point of calling it.
 */
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
  /** `N`, the CPU/memory cost. Must be a power of two. */
  cost: number
  /** `r`. */
  blockSize: number
  /** `p`. */
  parallelism: number
}

/**
 * N=2^16, r=8, p=2 — one of OWASP's listed scrypt configurations.
 *
 * Chosen over their first rung (N=2^17, r=8, p=1) on measurement, not taste:
 * both take ~230ms here, but this one needs 64 MiB per hash instead of 128.
 * `128 * N * r` is the peak allocation, login is unauthenticated, and the
 * container it runs in is small — so the rung that halves memory at equal time
 * and equal listed strength is the one to take. Concurrent attempts multiply
 * this, which is a reason for a rate limiter on login rather than for a weaker
 * hash.
 *
 * Exported so tests can run cheaper — hashing at this cost repeatedly would
 * make a suite unusable, and quietly lowering it inside the module would mean
 * testing a configuration nothing ships.
 */
export const defaultScryptParams: ScryptParams = { cost: 2 ** 16, blockSize: 8, parallelism: 2 }

const KEY_LENGTH = 64
const SALT_LENGTH = 16

/**
 * `maxmem` must be raised to match the parameters.
 *
 * Node's default is 32 MiB while scrypt needs `128 * N * r` — 64 MiB at the
 * settings above. Without this, hashing throws at the production cost while
 * passing every test at the cheap one, so the failure would first appear on
 * the first real login.
 */
const maxmemFor = ({ cost, blockSize }: ScryptParams) => Math.max(32 * 1024 * 1024, 256 * cost * blockSize)

const derive = async (password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> => {
  return scryptAsync(password.normalize('NFC'), salt, KEY_LENGTH, {
    N: params.cost,
    r: params.blockSize,
    p: params.parallelism,
    maxmem: maxmemFor(params),
  })
}

/**
 * `$scrypt$n=<N>,r=<r>,p=<p>$<salt>$<key>`, base64url throughout.
 *
 * The parameters live in the string because the cost has to rise as hardware
 * does, and a bare digest would make raising it invalidate every account.
 */
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

/**
 * A salt to hash against when there is nothing real to compare with.
 *
 * Fixed and public, because it protects nothing — its only job is to make the
 * work happen. See `verifyPassword`.
 */
const DECOY_SALT = Buffer.alloc(SALT_LENGTH, 0x5a)

/**
 * Whether `password` matches `stored`.
 *
 * Returns false rather than throwing for every unusable input — a null column
 * on a passkey-only account, a truncated row, a hash from another algorithm.
 * Throwing would answer 500 where a wrong password answers 401, which tells an
 * attacker which accounts have broken rows.
 *
 * **Every path derives a key, including the ones that cannot possibly match.**
 * Returning early on `null` is the obvious implementation and it is an account
 * enumeration oracle: measured here, a wrong password took 220ms and an unknown
 * address took 0ms, so anyone can ask "is this address a member?" and read the
 * answer off a stopwatch. On an app whose membership *is* the private part,
 * that is the whole secret. The decoy derivation costs one wasted hash per
 * failed login and closes it.
 *
 * `params` is used only for the decoy — a real hash carries its own. Exposed so
 * tests can burn a cheap hash rather than the production one.
 */
export const verifyPassword = async (
  password: string,
  stored: string | null,
  params = defaultScryptParams,
): Promise<boolean> => {
  const parsed = stored === null ? undefined : parseHash(stored)

  if (parsed === undefined) {
    // Not `return false` — see above.
    await derive(password, DECOY_SALT, params).catch(() => undefined)
    return false
  }

  try {
    const candidate = await derive(password, parsed.salt, parsed.params)
    // Length-checked first: timingSafeEqual throws on a mismatch rather than
    // returning false, and a truncated key column would otherwise 500.
    return candidate.length === parsed.key.length && timingSafeEqual(candidate, parsed.key)
  } catch {
    return false
  }
}

/**
 * Whether a stored hash was made with weaker parameters than we now use.
 *
 * True for anything unparseable as well, so a row written by an older or
 * broken path is replaced the next time its owner logs in successfully.
 */
export const needsRehash = (stored: string, params = defaultScryptParams): boolean => {
  const parsed = parseHash(stored)
  if (parsed === undefined) return true

  return (
    parsed.params.cost < params.cost ||
    parsed.params.blockSize < params.blockSize ||
    parsed.params.parallelism < params.parallelism
  )
}
