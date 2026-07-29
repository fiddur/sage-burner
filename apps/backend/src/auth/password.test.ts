import { describe, expect, it } from 'vitest'

import { hashPassword, needsRehash, verifyPassword } from './password.ts'

/**
 * Hashing is slow on purpose, so these use the lowest cost the module allows
 * rather than the production one. `scryptParams` is exported for exactly that.
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
      await expect(verifyPassword('x', stored, fast), stored).resolves.toBe(false)
    }
  })

  it('returns false for an account with no password set', async () => {
    // A passkey-only account has `password_hash: null`. Password login against
    // it must fail closed rather than treating absent as matching.
    await expect(verifyPassword('x', null, fast)).resolves.toBe(false)
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
      await verifyPassword('wrong', stored, fast)
      const started = performance.now()
      for (let i = 0; i < 5; i += 1) await verifyPassword('wrong', stored, fast)
      return (performance.now() - started) / 5
    }

    const withHash = await average(real)
    const withoutHash = await average(null)

    expect(withoutHash).toBeGreaterThan(withHash * 0.5)
  })
})

describe('needsRehash', () => {
  it('is false for a hash made with the current parameters', async () => {
    const stored = await hashPassword('x', fast)

    expect(needsRehash(stored, fast)).toBe(false)
  })

  it('is true once the cost is raised', async () => {
    const stored = await hashPassword('x', fast)

    expect(needsRehash(stored, { ...fast, cost: fast.cost * 2 })).toBe(true)
  })

  it('is true for anything unparseable, so a bad row gets replaced on next login', () => {
    expect(needsRehash('not-a-hash', fast)).toBe(true)
  })
})
