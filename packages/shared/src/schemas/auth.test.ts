import { describe, expect, it } from 'vitest'

import { emailSchema, loginRequestSchema, loginPasswordSchema, viewerSchema } from './auth.ts'

/**
 * The bounds here are security controls rather than tidiness, and neither was
 * asserted anywhere: removing `.max()` from either left the whole suite green.
 * The normalisation is likewise what keeps the account table's BINARY-collation
 * UNIQUE from splitting one human into two accounts, and it was covered only
 * indirectly, through an HTTP-level route test.
 */

describe('emailSchema', () => {
  it('lowercases and trims, because the lookup is byte-exact', () => {
    // SQLite's UNIQUE on TEXT uses BINARY collation, so `Admin@x.org` and
    // `admin@x.org` would be two accounts for one human — each with its own
    // roles, passkeys and membership.
    expect(emailSchema.parse('  Ada@Example.ORG  ')).toBe('ada@example.org')
  })

  it('rejects anything that is not an address', () => {
    for (const value of ['', 'ada', 'ada@', '@example.org', 'ada example.org']) {
      expect(emailSchema.safeParse(value).success, value).toBe(false)
    }
  })

  it('rejects an address longer than the RFC allows', () => {
    // 254 is the maximum length of a path in an SMTP transaction. Without the
    // bound, an arbitrarily long string reaches the database and the index.
    // `@example.org` is 12 characters, so 242 in the local part is exactly 254.
    const local = 'a'.repeat(242)

    expect(emailSchema.safeParse(`${local}@example.org`).success).toBe(true)
    expect(emailSchema.safeParse(`${local}a@example.org`).success).toBe(false)
  })

  it('trims before measuring, so surrounding space cannot push a valid address over', () => {
    const atTheLimit = `${'a'.repeat(242)}@example.org`

    expect(emailSchema.safeParse(`  ${atTheLimit}  `).success).toBe(true)
  })
})

describe('loginPasswordSchema', () => {
  it('accepts anything a member might already have', () => {
    // Deliberately no pattern rules: rejecting an existing password at the
    // login form because it fails a rule added later locks its owner out.
    for (const value of ['x', 'correct horse battery staple', '🔥🔥🔥', ' leading space']) {
      expect(loginPasswordSchema.safeParse(value).success, value).toBe(true)
    }
  })

  it('rejects an empty password rather than hashing one', () => {
    expect(loginPasswordSchema.safeParse('').success).toBe(false)
  })

  it('bounds the length, for body size rather than for CPU', () => {
    // Deliberately not "because scrypt hashes whatever it is given" — the schema
    // docblock exists to warn readers off exactly that reasoning. scrypt's cost
    // is set by N and r; the password feeds a single PBKDF2-HMAC-SHA256 pass.
    // Measured: 8 bytes 217ms, 1 KiB 216ms, 64 KiB 220ms — indistinguishable.
    //
    // The bound is still worth having, for request body size, log volume, and
    // not handing unbounded input to a crypto primitive.
    expect(loginPasswordSchema.safeParse('a'.repeat(1024)).success).toBe(true)
    expect(loginPasswordSchema.safeParse('a'.repeat(1025)).success).toBe(false)
  })
})

describe('loginRequestSchema', () => {
  it('normalises the email on the way through', () => {
    expect(loginRequestSchema.parse({ email: ' Ada@Example.ORG ', password: 'x' })).toEqual({
      email: 'ada@example.org',
      password: 'x',
    })
  })

  it('does not touch the password', () => {
    // Trimming or case-folding a password would silently change what the member
    // typed and fail a login they got right.
    expect(loginRequestSchema.parse({ email: 'a@b.org', password: '  Pass Word  ' }).password).toBe(
      '  Pass Word  ',
    )
  })

  it('requires both fields', () => {
    expect(loginRequestSchema.safeParse({ email: 'a@b.org' }).success).toBe(false)
    expect(loginRequestSchema.safeParse({ password: 'x' }).success).toBe(false)
  })
})

describe('viewerSchema', () => {
  // A literal rather than `randomUUID`: this package is imported by the browser
  // bundle and deliberately has no Node types, so `node:crypto` does not
  // typecheck here — which is the constraint working, not an inconvenience.
  const accountId = '5f9d4a0e-3c1b-4d7a-9e2f-8b6c0a1d3e4f'

  it('accepts an account with no roles, which is what an applicant has', () => {
    expect(viewerSchema.safeParse({ account_id: accountId, roles: [] }).success).toBe(true)
  })

  it('rejects a role outside the vocabulary', () => {
    expect(viewerSchema.safeParse({ account_id: accountId, roles: ['superuser'] }).success).toBe(false)
  })

  it('carries no email, so an XSS finds one less thing already fetched', () => {
    const parsed = viewerSchema.parse({ account_id: accountId, roles: ['admin'] })

    expect(Object.keys(parsed).sort()).toEqual(['account_id', 'roles'])
  })
})
