import { describe, expect, it } from 'vitest'

import type { ScryptParams } from './password.ts'

import { defaultScryptParams, hashPassword, needsRehash, verifyPassword } from './password.ts'

/**
 * Hashing is slow on purpose, so these run at a cost far below the production
 * one — a suite hashing at ~230ms a time would be a suite nobody runs.
 *
 * A local literal rather than the module's `defaultScryptParams`: passing the
 * cost in explicitly is what lets a test assert behaviour *across* parameter
 * sets, which is most of what `needsRehash` is for.
 */
const fast = { cost: 2 ** 12, blockSize: 8, parallelism: 1 }

describe('hashPassword', () => {
  it('produces a verifiable hash', async () => {
    const stored = await hashPassword('correct horse battery staple', fast)

    await expect(verifyPassword('correct horse battery staple', stored)).resolves.toBe(true)
  })

  it('rejects the wrong password', async () => {
    const stored = await hashPassword('correct horse battery staple', fast)

    await expect(verifyPassword('Correct horse battery staple', stored)).resolves.toBe(false)
  })

  it('gives two different hashes for the same password', async () => {
    // Per-hash salt. Without it, identical passwords are identical rows, and
    // one cracked hash reveals every account sharing that password.
    const a = await hashPassword('same', fast)
    const b = await hashPassword('same', fast)

    expect(a).not.toBe(b)
    await expect(verifyPassword('same', a)).resolves.toBe(true)
    await expect(verifyPassword('same', b)).resolves.toBe(true)
  })

  it('records the parameters it used, so they can change later', async () => {
    // The cost has to rise as hardware does. Without the parameters in the
    // string, raising them would invalidate every existing hash at once.
    const stored = await hashPassword('x', fast)

    expect(stored.startsWith('$scrypt$')).toBe(true)
    expect(stored).toContain(`n=${fast.cost}`)
  })

  it('survives a unicode password unchanged', async () => {
    const password = 'gräs­änder på ängen 🔥'

    await expect(verifyPassword(password, await hashPassword(password, fast))).resolves.toBe(true)
  })
})

describe('verifyPassword', () => {
  it('returns false rather than throwing on a malformed stored value', async () => {
    // A truncated column, a hash from another algorithm, or an empty string
    // must fail the login — not 500 it, which would tell an attacker the
    // difference between a broken row and a wrong password.
    for (const stored of ['', 'not-a-hash', '$scrypt$', '$scrypt$n=1$abc', '$bcrypt$x$y']) {
      await expect(verifyPassword('x', stored, { params: fast }), stored).resolves.toBe(false)
    }
  })

  it('returns false for an account with no password set', async () => {
    // A passkey-only account has `password_hash: null`. Password login against
    // it must fail closed rather than treating absent as matching.
    await expect(verifyPassword('x', null, { params: fast })).resolves.toBe(false)
  })

  it('spends the same work on an absent hash as on a wrong one', async () => {
    // The account-enumeration oracle. `if (stored === null) return false` is the
    // obvious implementation and measured 220ms vs 0ms — a stopwatch answers
    // "is this address a member?", which on this app is the private part.
    //
    // Compared as a ratio, not in milliseconds: a loaded CI runner slows both
    // paths together, so the ratio holds where an absolute bound would flake.
    // The threshold is deliberately loose — this needs to catch an early
    // return, not measure a cache line.
    const real = await hashPassword('the right passphrase', fast)

    const average = async (stored: string | null) => {
      await verifyPassword('wrong', stored, { params: fast })
      const started = performance.now()
      for (let i = 0; i < 5; i += 1) await verifyPassword('wrong', stored, { params: fast })
      return (performance.now() - started) / 5
    }

    const withHash = await average(real)
    const withoutHash = await average(null)

    expect(withoutHash).toBeGreaterThan(withHash * 0.5)
  })
})

describe('reporting a broken setup', () => {
  // A systemic failure — bad parameters at the production cost, an allocation
  // failure under pressure — presents as every login being rejected, with the
  // same status, body and latency as a typo. Returning false stays right;
  // saying nothing does not.
  const brokenParams = { cost: 3, blockSize: 8, parallelism: 1 } // N must be a power of two

  it('reports a failure while verifying a real hash, and still returns false', async () => {
    const stored = await hashPassword('x', fast)
    const seen: unknown[] = []

    // A hash whose *stored* parameters are unusable: parseable, so it takes the
    // real path, then fails inside scrypt.
    const corrupted = stored.replace(`n=${fast.cost}`, 'n=3')
    const result = await verifyPassword('x', corrupted, { onError: (error) => seen.push(error) })

    expect(result).toBe(false)
    expect(seen).toHaveLength(1)
    expect(String(seen[0])).toContain('scrypt')
  })

  it('reports a failure on the decoy path too', async () => {
    // The unknown-address path. Silence here would hide a broken setup for
    // exactly the requests an attacker is generating.
    const seen: unknown[] = []

    const result = await verifyPassword('x', null, { params: brokenParams, onError: (e) => seen.push(e) })

    expect(result).toBe(false)
    expect(seen).toHaveLength(1)
  })

  it('is optional, so a caller that does not care is unaffected', async () => {
    await expect(verifyPassword('x', null, { params: brokenParams })).resolves.toBe(false)
  })

  it('is not called when a password merely fails to match', async () => {
    // Otherwise the log fills with one error per wrong password and the signal
    // this exists for is buried.
    const stored = await hashPassword('right', fast)
    const seen: unknown[] = []

    await verifyPassword('wrong', stored, { params: fast, onError: (error) => seen.push(error) })

    expect(seen).toEqual([])
  })
})

/**
 * A hash string whose *recorded* parameters are `params`, without doing the work.
 *
 * `needsRehash` only reads the parameters out of the string — the salt and key
 * are irrelevant to it — so the cases below do not need a real hash at those
 * settings. They used to call `hashPassword` at N=2^17, which is ~2x the 230ms
 * production figure and 128 MiB, twice, in a suite that otherwise deliberately
 * keeps to cheap parameters.
 *
 * The substitution is asserted rather than assumed: a silent no-op here would
 * leave both tests comparing `fast` against `fast` and passing for nothing.
 */
const recordedAt = async (params: ScryptParams) => {
  const stored = await hashPassword('x', fast)
  const from = `n=${fast.cost},r=${fast.blockSize},p=${fast.parallelism}`
  const to = `n=${params.cost},r=${params.blockSize},p=${params.parallelism}`
  if (!stored.includes(from)) throw new Error(`hash format changed: ${stored}`)

  return stored.replace(from, to)
}

describe('needsRehash', () => {
  it('is false for a hash made with the current parameters', async () => {
    const stored = await hashPassword('x', fast)

    expect(needsRehash(stored, fast)).toBe(false)
  })

  it('is true once the cost is raised', async () => {
    const stored = await hashPassword('x', fast)

    expect(needsRehash(stored, { ...fast, cost: fast.cost * 2 })).toBe(true)
  })

  it('never downgrades a hash that is stronger on any axis', async () => {
    // The concrete case: OWASP's other listed rung, and the one
    // `defaultScryptParams` was measured against. It has p=1 against our p=2, so
    // a field-wise `<` called it stale — and the login path would have rewritten
    // N=2^17 down to N=2^16, halving memory-hardness on a *successful* login.
    const stored = await recordedAt({ cost: 2 ** 17, blockSize: 8, parallelism: 1 })

    expect(needsRehash(stored, defaultScryptParams)).toBe(false)
  })

  it('leaves a hash alone when one axis is higher and another lower', async () => {
    // Deliberately conservative rather than clever: a mixed comparison is not a
    // work comparison, so it is left as it is instead of guessed about.
    const stored = await recordedAt({ cost: 2 ** 17, blockSize: 4, parallelism: 2 })

    expect(needsRehash(stored, defaultScryptParams)).toBe(false)
  })

  it('still upgrades a hash weaker on every axis', async () => {
    // The guard must not have turned into "never rehash".
    const stored = await hashPassword('x', fast)

    expect(needsRehash(stored, defaultScryptParams)).toBe(true)
  })

  it('is true for anything unparseable, so a bad row gets replaced on next login', () => {
    expect(needsRehash('not-a-hash', fast)).toBe(true)
  })
})
