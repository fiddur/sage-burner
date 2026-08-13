import { describe, expect, it } from 'vitest'

import {
  applyingOutcomes,
  applyPage,
  bringPage,
  linkingOutcomes,
  loginPage,
  meetingsPage,
  oauthOutcomes,
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
