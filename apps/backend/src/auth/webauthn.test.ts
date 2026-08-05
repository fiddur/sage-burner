import { describe, expect, it } from 'vitest'

import { knownTransports, relyingParty } from './webauthn.ts'

describe('relyingParty', () => {
  it('takes the configured origin over the one the request claims', () => {
    // The claim is the browser's, and a proxy relaying this app makes it its own.
    expect(relyingParty('https://burn.example.org', 'https://phishing.example.net')).toEqual({
      id: 'burn.example.org',
      origin: 'https://burn.example.org',
    })
  })

  it('falls back to the request origin when nothing is configured', () => {
    expect(relyingParty(undefined, 'http://localhost:5173')).toEqual({
      id: 'localhost',
      origin: 'http://localhost:5173',
    })
  })

  it('drops a path or a trailing slash left on the configured value', () => {
    // Otherwise a `PUBLIC_ORIGIN=https://burn.example.org/` never matches the
    // origin the browser reports, and every ceremony fails for a reason nobody
    // can see in the copy.
    expect(relyingParty('https://burn.example.org/', undefined)?.origin).toBe('https://burn.example.org')
    expect(relyingParty('https://burn.example.org/app', undefined)?.origin).toBe('https://burn.example.org')
  })

  it('keeps the port, which is part of an origin', () => {
    expect(relyingParty('http://localhost:3000', undefined)).toEqual({
      id: 'localhost',
      origin: 'http://localhost:3000',
    })
  })

  it('has nothing to answer when neither is available', () => {
    expect(relyingParty(undefined, undefined)).toBeUndefined()
  })

  it('has nothing to answer for an opaque origin', () => {
    // What a sandboxed iframe or a redirected form sends. `new URL('null')`
    // throws rather than parsing, but saying so here keeps it from depending on
    // that.
    expect(relyingParty(undefined, 'null')).toBeUndefined()
  })

  it('has nothing to answer for something that is not a URL', () => {
    expect(relyingParty(undefined, 'burn.example.org')).toBeUndefined()
  })
})

describe('knownTransports', () => {
  it('keeps the ones a browser can act on', () => {
    expect(knownTransports(['internal', 'hybrid', 'usb'])).toEqual(['internal', 'hybrid', 'usb'])
  })

  it('drops one it does not recognise rather than refusing the lot', () => {
    // A transport is a hint about how to reach an authenticator. A device
    // reporting one this list predates should still register, with one fewer hint.
    expect(knownTransports(['internal', 'quantum-entanglement'])).toEqual(['internal'])
  })

  it('says nothing when the browser said nothing', () => {
    expect(knownTransports(undefined)).toBeUndefined()
  })
})
