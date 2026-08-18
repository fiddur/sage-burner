import { apiRoutes } from '@sage-burner/shared'
import { describe, expect, it } from 'vitest'

import { maskedUrl, REDACTED, requestSerializer } from './logging.ts'

describe('what a logged URL keeps', () => {
  it('takes the token out of a reset link, which is a password in a log line', () => {
    expect(maskedUrl(apiRoutes.getPasswordResetState.path('a-secret-token'))).toBe(
      `/api/auth/resets/${REDACTED}`,
    )
  })

  it('takes it out of an invite too, the same thing being spendable there', () => {
    expect(maskedUrl(apiRoutes.getInviteState.path('a-secret-token'))).toBe(`/api/invites/${REDACTED}`)
  })

  it('keeps the segments past the token, so a redeem still says what it was', () => {
    expect(maskedUrl(apiRoutes.redeemInvite.path('a-secret-token'))).toBe(`/api/invites/${REDACTED}/redeem`)
  })

  it('keeps the query, which carries no token', () => {
    expect(maskedUrl('/api/invites/a-secret-token?from=refused')).toBe(
      `/api/invites/${REDACTED}?from=refused`,
    )
  })

  it('leaves every other path exactly as it was', () => {
    expect(maskedUrl('/api/feed?kinds=song')).toBe('/api/feed?kinds=song')
    expect(maskedUrl('/api/auth/login')).toBe('/api/auth/login')
  })

  it('leaves the collection path alone, there being no token in it', () => {
    expect(maskedUrl('/api/invites/')).toBe('/api/invites/')
  })
})

describe('what the serializer reports', () => {
  it('masks the URL and keeps the fields fastify logs', () => {
    expect(
      requestSerializer({
        method: 'GET',
        url: '/api/auth/resets/a-secret-token',
        headers: { 'accept-version': '1' },
        host: 'burn.example.org',
        ip: '10.0.0.1',
        socket: { remotePort: 4242 },
      }),
    ).toEqual({
      method: 'GET',
      url: `/api/auth/resets/${REDACTED}`,
      version: '1',
      host: 'burn.example.org',
      remoteAddress: '10.0.0.1',
      remotePort: 4242,
    })
  })

  it('reports nothing rather than throwing on something that is not a request', () => {
    expect(requestSerializer(undefined)).toEqual({
      method: undefined,
      url: undefined,
      version: undefined,
      host: undefined,
      remoteAddress: undefined,
      remotePort: undefined,
    })
  })
})
