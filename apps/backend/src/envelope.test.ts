import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'

import { admitsEnvelope, refuseEnvelopeStrippers } from './envelope.ts'

const withSchema = (response: Record<string, unknown>) => {
  const app = Fastify({ logger: false })
  refuseEnvelopeStrippers(app)

  return () => app.get('/thing', { schema: { response } }, () => ({ ok: true }))
}

describe('what a schema admits', () => {
  it('lets the envelope through when it names it', () => {
    expect(admitsEnvelope({ type: 'object', properties: { error: { type: 'string' } } })).toBe(true)
  })

  it('does not, when it names other things', () => {
    expect(admitsEnvelope({ type: 'object', properties: { detail: { type: 'string' } } })).toBe(false)
  })

  it('does not, for an object that names nothing', () => {
    expect(admitsEnvelope({ type: 'object' })).toBe(false)
  })

  it('does not, for something that is not a schema at all', () => {
    expect(admitsEnvelope(undefined)).toBe(false)
    expect(admitsEnvelope(null)).toBe(false)
    expect(admitsEnvelope('object')).toBe(false)
  })

  it('does not, when `error` is declared as something other than a string', () => {
    expect(admitsEnvelope({ properties: { error: { type: 'object' } } })).toBe(false)
  })
})

describe('refusing a route that would strip its own errors', () => {
  it('throws at registration for a numeric error status', () => {
    expect(withSchema({ 400: { type: 'object', properties: { detail: { type: 'string' } } } })).toThrow(
      /strip the error envelope/,
    )
  })

  it('throws for the wildcard forms too, which behave the same way', () => {
    expect(withSchema({ '4xx': { type: 'object' } })).toThrow(/strip the error envelope/)
    expect(withSchema({ '5xx': { type: 'object' } })).toThrow(/strip the error envelope/)
  })

  it('names the route and the status, so the fix is where the message points', () => {
    expect(withSchema({ 409: { type: 'object' } })).toThrow(/GET \/thing declares a 409/)
  })

  it('allows an error schema that lets the envelope through', () => {
    expect(withSchema({ 409: { type: 'object', properties: { error: { type: 'string' } } } })).not.toThrow()
  })

  it('allows a route that declares only a success, which is every route here', () => {
    expect(withSchema({ 200: { type: 'object', properties: { thing: { type: 'string' } } } })).not.toThrow()
  })

  it('allows a route with no schema at all', () => {
    const app = Fastify({ logger: false })
    refuseEnvelopeStrippers(app)

    expect(() => app.get('/bare', () => ({ ok: true }))).not.toThrow()
  })
})
