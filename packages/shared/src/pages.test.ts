import { describe, expect, it } from 'vitest'

import {
  applyingOutcomes,
  applyPage,
  bringPage,
  formattingPage,
  INVITE_PATTERN,
  invitePage,
  linkingOutcomes,
  loginPage,
  meetingsPage,
  oauthOutcomes,
  RESET_PATTERN,
  resetPage,
  rolesPage,
  signingInOutcomes,
} from './pages.ts'

describe('where an outcome can land', () => {
  it('files every one under at least one page, so neither list can go stale silently', () => {
    for (const outcome of oauthOutcomes) {
      const filed =
        signingInOutcomes.some((one) => one === outcome) ||
        linkingOutcomes.some((one) => one === outcome) ||
        applyingOutcomes.some((one) => one === outcome)

      expect(filed, outcome).toBe(true)
    }
  })

  it('keeps what lands on apply off the sign-in list, a provider with no address signing nobody in', () => {
    expect(signingInOutcomes).not.toContain('no-address')
    expect(applyingOutcomes).toContain('no-address')
  })

  it('files what goes wrong at the provider under both, since it lands where it started', () => {
    for (const outcome of ['refused', 'misconfigured', 'unreachable'] as const) {
      expect(signingInOutcomes).toContain(outcome)
      expect(linkingOutcomes).toContain(outcome)
    }
  })
})

describe('the pages a round trip comes back to', () => {
  it('carries the outcome, and the request to quote where there is one', () => {
    expect(loginPage('refused')).toBe('/login?from=refused')
    expect(applyPage('no-address', 'req-8s')).toBe('/apply?from=no-address&ref=req-8s')
  })

  it('is the bare page for an ordinary visit', () => {
    expect(loginPage()).toBe('/login')
    expect(applyPage()).toBe('/apply')
  })
})

describe('the bring list', () => {
  it('names the burn it belongs to, and the item when there is one to open', () => {
    expect(bringPage('burn-1')).toBe('/bring?burn=burn-1')
    expect(bringPage('burn-1', 'item-2')).toBe('/bring?burn=burn-1&item=item-2')
  })

  it('encodes both, so an id cannot invent a parameter', () => {
    expect(bringPage('a&b', 'c=d')).toBe('/bring?burn=a%26b&item=c%3Dd')
  })
})

describe('the meetings page', () => {
  it('names the burn it belongs to, and the point when there is one to open', () => {
    expect(meetingsPage('burn-1')).toBe('/meetings?burn=burn-1')
    expect(meetingsPage('burn-1', 'p-2')).toBe('/meetings?burn=burn-1&point=p-2')
  })

  it('encodes both, so an id cannot invent a parameter', () => {
    expect(meetingsPage('a&b', 'c=d')).toBe('/meetings?burn=a%26b&point=c%3Dd')
  })
})

describe('the lead-roles register', () => {
  it('names the burn it belongs to, a role card linking to the register at its own burn', () => {
    expect(rolesPage('burn-1')).toBe('/roles?burn=burn-1')
  })

  it('encodes it, so an id cannot invent a parameter', () => {
    expect(rolesPage('a&b')).toBe('/roles?burn=a%26b')
  })
})

describe('the formatting help', () => {
  it('belongs to no burn and takes no parameter, an applicant reading it as well', () => {
    expect(formattingPage()).toBe('/formatting')
  })
})

describe('a page whose path carries a token', () => {
  const filled = (pattern: string, token: string) => pattern.replace(':token', encodeURIComponent(token))

  it('builds what its own router pattern routes to, so the two spellings cannot drift', () => {
    expect(resetPage('a-token')).toBe(filled(RESET_PATTERN, 'a-token'))
    expect(invitePage('a-token')).toBe(filled(INVITE_PATTERN, 'a-token'))
  })

  it('encodes the token, a slash in one otherwise inventing a path segment', () => {
    expect(resetPage('a/b')).toBe('/reset/a%2Fb')
    expect(invitePage('a/b')).toBe('/invite/a%2Fb')
  })
})
