import { describe, expect, it } from 'vitest'
import webpush from 'web-push'

import { outcomeFor } from './web-push.ts'

/**
 * The one part of delivery that can be tested here.
 *
 * Sending needs a real browser to produce a subscription and a real push service to
 * accept one, so `deliverWithWebPush` is exercised only in production. This is the
 * pure decision inside it, and it is the one that deletes rows.
 */

const aWebPushError = (statusCode: number) =>
  new webpush.WebPushError('rejected', statusCode, {}, '', 'https://push.example/one')

describe('outcomeFor', () => {
  it('treats 404 and 410 as the browser having thrown the subscription away', () => {
    // Both, not just one: 410 Gone is what a push service usually answers for an
    // expired subscription, and 404 is what some answer instead. Keeping either
    // would retry a dead endpoint on every application forever.
    expect(outcomeFor(aWebPushError(404))).toBe('gone')
    expect(outcomeFor(aWebPushError(410))).toBe('gone')
  })

  it('keeps the subscription for anything else the service says', () => {
    // A bad night from Google is not a reason to forget somebody's phone. 429 is
    // the interesting one — it means "slow down", not "this is gone".
    for (const status of [400, 401, 403, 413, 429, 500, 502, 503]) {
      expect(outcomeFor(aWebPushError(status)), String(status)).toBe('failed')
    }
  })

  it('keeps it for a failure that is not the push service at all', () => {
    // A DNS failure or a timeout arrives as an ordinary Error with no status. It
    // says nothing about whether the browser still holds the subscription.
    expect(outcomeFor(new Error('getaddrinfo ENOTFOUND'))).toBe('failed')
    expect(outcomeFor(undefined)).toBe('failed')
  })
})
