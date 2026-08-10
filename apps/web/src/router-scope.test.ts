import type { RouteKey } from '@sage-burner/shared'

import { apiRoutes } from '@sage-burner/shared'
import { describe, expect, it } from 'vitest'

import { ROUTER_SCOPE } from './router-scope.ts'

const keys = Object.keys(apiRoutes) as RouteKey[]

describe('what the client-side router may claim', () => {
  it('leaves every registered backend path to the browser', () => {
    // Walked rather than listed, which is the property worth having: a route added outside
    // `/api` — the calendar feed and the manifest are already two — fails here instead of
    // becoming another link that renders "Nothing here" when somebody clicks it.
    for (const key of keys) {
      expect(ROUTER_SCOPE.test(apiRoutes[key].fastify), key).toBe(false)
    }
  })

  it('leaves a built path alone too, not just the pattern', () => {
    // `isInScope` sees the `href` attribute, which is what `path()` produced — so the filled
    // segments, not the `:param` template, are what actually has to fall outside.
    expect(ROUTER_SCOPE.test(apiRoutes.startOauthLink.path('facebook'))).toBe(false)
    expect(ROUTER_SCOPE.test(apiRoutes.startOauthSignIn.path('facebook'))).toBe(false)
    expect(ROUTER_SCOPE.test(apiRoutes.scheduleFeed.path('token-1'))).toBe(false)
  })

  it('claims the pages the app actually serves', () => {
    // The passing sibling. Without it every one of the above holds for a scope that matches
    // nothing at all, which would turn each in-app link into a full page load.
    for (const path of ['/', '/profile', '/members', '/members/abc', '/privacy', '/terms', '/changelog']) {
      expect(ROUTER_SCOPE.test(path), path).toBe(true)
    }
  })

  it('does not mistake a page for the API by prefix alone', () => {
    // `/apiary` starts with `api`. The trailing slash in the pattern is what separates them,
    // and a page could plausibly be named that.
    expect(ROUTER_SCOPE.test('/apiary')).toBe(true)
    expect(ROUTER_SCOPE.test('/calendars')).toBe(true)
  })
})
