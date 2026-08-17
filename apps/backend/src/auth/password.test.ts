import { describe, expect, it } from 'vitest'

import type { ScryptParams } from './password.ts'

import { defaultScryptParams, hashPassword, needsRehash, verifyPassword } from './password.ts'

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
    const a = await hashPassword('same', fast)
    const b = await hashPassword('same', fast)

    expect(a).not.toBe(b)
    await expect(verifyPassword('same', a)).resolves.toBe(true)
    await expect(verifyPassword('same', b)).resolves.toBe(true)
  })

  it('records the parameters it used, so they can change later', async () => {
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
    for (const stored of ['', 'not-a-hash', '$scrypt$', '$scrypt$n=1$abc', '$bcrypt$x$y']) {
      await expect(verifyPassword('x', stored, { params: fast }), stored).resolves.toBe(false)
    }
  })

  it('returns false for an account with no password set', async () => {
    await expect(verifyPassword('x', null, { params: fast })).resolves.toBe(false)
  })

  it('spends the same work on an absent hash as on a wrong one', async () => {
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
  const brokenParams = { cost: 3, blockSize: 8, parallelism: 1 } // N must be a power of two

  it('reports a failure while verifying a real hash, and still returns false', async () => {
    const stored = await hashPassword('x', fast)
    const seen: unknown[] = []

    const corrupted = stored.replace(`n=${fast.cost}`, 'n=3')
    const result = await verifyPassword('x', corrupted, { onError: (error) => seen.push(error) })

    expect(result).toBe(false)
    expect(seen).toHaveLength(1)
    expect(String(seen[0])).toContain('scrypt')
  })

  it('reports a failure on the decoy path too', async () => {
    const seen: unknown[] = []

    const result = await verifyPassword('x', null, { params: brokenParams, onError: (e) => seen.push(e) })

    expect(result).toBe(false)
    expect(seen).toHaveLength(1)
  })

  it('is optional, so a caller that does not care is unaffected', async () => {
    await expect(verifyPassword('x', null, { params: brokenParams })).resolves.toBe(false)
  })

  it('is not called when a password merely fails to match', async () => {
    const stored = await hashPassword('right', fast)
    const seen: unknown[] = []

    await verifyPassword('wrong', stored, { params: fast, onError: (error) => seen.push(error) })

    expect(seen).toEqual([])
  })
})

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
    const stored = await recordedAt({ cost: 2 ** 17, blockSize: 8, parallelism: 1 })

    expect(needsRehash(stored, defaultScryptParams)).toBe(false)
  })

  it('leaves a hash alone when one axis is higher and another lower', async () => {
    const stored = await recordedAt({ cost: 2 ** 17, blockSize: 4, parallelism: 2 })

    expect(needsRehash(stored, defaultScryptParams)).toBe(false)
  })

  it('still upgrades a hash weaker on every axis', async () => {
    const stored = await hashPassword('x', fast)

    expect(needsRehash(stored, defaultScryptParams)).toBe(true)
  })

  it('is true for anything unparseable, so a bad row gets replaced on next login', () => {
    expect(needsRehash('not-a-hash', fast)).toBe(true)
  })
})
