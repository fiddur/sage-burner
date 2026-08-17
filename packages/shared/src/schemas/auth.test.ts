import { describe, expect, it } from 'vitest'

import { emailSchema, loginPasswordSchema, loginRequestSchema, viewerSchema } from './auth.ts'

describe('emailSchema', () => {
  it('lowercases and trims, because the lookup is byte-exact', () => {
    expect(emailSchema.parse('  Ada@Example.ORG  ')).toBe('ada@example.org')
  })

  it('rejects anything that is not an address', () => {
    for (const value of ['', 'ada', 'ada@', '@example.org', 'ada example.org']) {
      expect(emailSchema.safeParse(value).success, value).toBe(false)
    }
  })

  it('rejects an address longer than the RFC allows', () => {
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
    for (const value of ['x', 'correct horse battery staple', '🔥🔥🔥', ' leading space']) {
      expect(loginPasswordSchema.safeParse(value).success, value).toBe(true)
    }
  })

  it('rejects an empty password rather than hashing one', () => {
    expect(loginPasswordSchema.safeParse('').success).toBe(false)
  })

  it('bounds the length, for body size rather than for CPU', () => {
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
  const accountId = '5f9d4a0e-3c1b-4d7a-9e2f-8b6c0a1d3e4f'

  it('accepts an account with no roles, which is what an applicant has', () => {
    expect(
      viewerSchema.safeParse({ account_id: accountId, name: null, avatar: null, roles: [] }).success,
    ).toBe(true)
  })

  it('rejects a role outside the vocabulary', () => {
    expect(
      viewerSchema.safeParse({ account_id: accountId, name: null, avatar: null, roles: ['superuser'] })
        .success,
    ).toBe(false)
  })

  it('accepts a name nobody has filled in, which the bootstrap admin has', () => {
    expect(viewerSchema.safeParse({ account_id: accountId, roles: [] }).success).toBe(false)
    expect(
      viewerSchema.safeParse({ account_id: accountId, name: null, avatar: null, roles: [] }).success,
    ).toBe(true)
  })

  it('carries no email, so an XSS finds one less thing already fetched', () => {
    const parsed = viewerSchema.parse({ account_id: accountId, name: 'Ada', avatar: null, roles: ['admin'] })

    expect(Object.keys(parsed).sort()).toEqual(['account_id', 'avatar', 'name', 'roles'])
  })
})
