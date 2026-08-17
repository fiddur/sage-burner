import type { RouteKey } from '@sage-burner/shared'

import { apiRoutes } from '@sage-burner/shared'
import { describe, expect, it } from 'vitest'

import { ROUTER_SCOPE } from './router-scope.ts'

const keys = Object.keys(apiRoutes) as RouteKey[]

describe('what the client-side router may claim', () => {
  it('leaves every registered backend path to the browser', () => {
    for (const key of keys) {
      expect(ROUTER_SCOPE.test(apiRoutes[key].fastify), key).toBe(false)
    }
  })

  it('leaves a built path alone too, not just the pattern', () => {
    expect(ROUTER_SCOPE.test(apiRoutes.startOauthLink.path('facebook'))).toBe(false)
    expect(ROUTER_SCOPE.test(apiRoutes.startOauthSignIn.path('facebook'))).toBe(false)
    expect(ROUTER_SCOPE.test(apiRoutes.scheduleFeed.path('token-1'))).toBe(false)
  })

  it('claims the pages the app actually serves', () => {
    for (const path of ['/', '/profile', '/members', '/members/abc', '/privacy', '/terms', '/changelog']) {
      expect(ROUTER_SCOPE.test(path), path).toBe(true)
    }
  })

  it('does not mistake a page for the API by prefix alone', () => {
    expect(ROUTER_SCOPE.test('/apiary')).toBe(true)
    expect(ROUTER_SCOPE.test('/calendars')).toBe(true)
  })
})
