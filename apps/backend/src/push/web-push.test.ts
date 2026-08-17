import { describe, expect, it } from 'vitest'
import webpush from 'web-push'

import { outcomeFor } from './web-push.ts'

const aWebPushError = (statusCode: number) =>
  new webpush.WebPushError('rejected', statusCode, {}, '', 'https://push.example/one')

describe('outcomeFor', () => {
  it('treats 404 and 410 as the browser having thrown the subscription away', () => {
    expect(outcomeFor(aWebPushError(404))).toBe('gone')
    expect(outcomeFor(aWebPushError(410))).toBe('gone')
  })

  it('keeps the subscription for anything else the service says', () => {
    for (const status of [400, 401, 403, 413, 429, 500, 502, 503]) {
      expect(outcomeFor(aWebPushError(status)), String(status)).toBe('failed')
    }
  })

  it('keeps it for a failure that is not the push service at all', () => {
    expect(outcomeFor(new Error('getaddrinfo ENOTFOUND'))).toBe('failed')
    expect(outcomeFor(undefined)).toBe('failed')
  })
})
