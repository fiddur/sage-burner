import type { FastifyInstance } from 'fastify'

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from './db/index.ts'

import { createApp } from './app.ts'
import { createConfig } from './config.ts'
import { createDb, runMigrations } from './db/index.ts'

let handle: DbHandle | undefined
let app: FastifyInstance | undefined
let webRoot: string | undefined

const build = async (): Promise<FastifyInstance> => {
  webRoot = mkdtempSync(join(tmpdir(), 'sage-headers-'))
  mkdirSync(join(webRoot, 'assets'), { recursive: true })
  writeFileSync(
    join(webRoot, 'index.html'),
    '<!doctype html><html><head><title>x</title></head><body><div id="app"></div></body></html>',
  )
  writeFileSync(join(webRoot, 'assets', 'index.js'), 'console.log(1)')

  handle = createDb({ url: ':memory:' })
  runMigrations(handle)
  app = await createApp({
    db: handle.db,
    config: createConfig({ LOG_LEVEL: 'silent', SESSION_SECRET: 't'.repeat(40), WEB_ROOT: webRoot }),
  })
  return app
}

afterEach(async () => {
  await app?.close()
  handle?.close()
  if (webRoot !== undefined) rmSync(webRoot, { recursive: true, force: true })
  app = undefined
  handle = undefined
  webRoot = undefined
})

const directives = (csp: string) =>
  new Map(
    csp
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name = '', ...values] = part.split(/\s+/)
        return [name, values]
      }),
  )

const fetchingRels = new Set(['stylesheet', 'modulepreload', 'icon', 'manifest', 'preload', 'prefetch'])

const externallyFetchingLinks = (html: string): string[] =>
  [...html.matchAll(/<link\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter((tag) => {
      const href = /\bhref\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1]
      if (href === undefined || !/^(?:https?:)?\/\//i.test(href)) return false

      const rel = /\brel\s*=\s*["']?([^"'>]*)/i.exec(tag)?.[1] ?? ''
      return rel
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        .some((token) => fetchingRels.has(token) || token.endsWith('-icon'))
    })

describe('security headers', () => {
  it('sends them on the API, the SPA shell, and a hashed asset alike', async () => {
    const server = await build()

    for (const url of ['/api/version', '/some/client/route', '/assets/index.js']) {
      const response = await server.inject({ method: 'GET', url })

      expect(response.headers['x-content-type-options'], url).toBe('nosniff')
      expect(response.headers['referrer-policy'], url).toBe('no-referrer')
      expect(response.headers['content-security-policy'], url).toBeDefined()
    }
  })

  it('refuses to be framed at all, not merely by another origin', async () => {
    const server = await build()

    const response = await server.inject({ method: 'GET', url: '/' })

    expect(directives(String(response.headers['content-security-policy'])).get('frame-ancestors')).toEqual([
      "'none'",
    ])
    expect(response.headers['x-frame-options']).toBe('DENY')
  })

  it('leaks no referrer, since an invite token travels in the path', async () => {
    expect(
      (await (await build()).inject({ method: 'GET', url: '/invite/abc' })).headers['referrer-policy'],
    ).toBe('no-referrer')
  })

  it('allows no inline script or style anywhere in the policy', async () => {
    const server = await build()

    const csp = (await server.inject({ method: 'GET', url: '/' })).headers['content-security-policy']

    expect(typeof csp).toBe('string')
    expect(csp).not.toContain('unsafe-inline')
    expect(csp).not.toContain('unsafe-eval')
  })

  it('confines every fetch to this origin, images aside', async () => {
    const server = await build()

    const csp = (await server.inject({ method: 'GET', url: '/' })).headers['content-security-policy']
    const found = directives(String(csp))

    expect(found.get('default-src')).toEqual(["'self'"])
    expect(found.get('script-src')).toEqual(["'self'"])
    expect(found.get('style-src')).toEqual(["'self'"])
    expect(found.get('object-src')).toEqual(["'none'"])
    expect(found.get('font-src')).toEqual(["'self'"])
    expect(found.get('base-uri')).toEqual(["'none'"])
    expect(found.get('img-src')).toEqual(["'self'", 'data:', 'https:'])
  })

  it('asks browsers to remember the TLS, which Apache terminates', async () => {
    expect(
      (await (await build()).inject({ method: 'GET', url: '/' })).headers['strict-transport-security'],
    ).toBe('max-age=31536000; includeSubDomains')
  })
})

describe('the CSP against the actual page it protects', () => {
  it('holds because the HTML entry point has nothing inline in it', async () => {
    const template = readFileSync(join(import.meta.dirname, '../../web/index.html'), 'utf8')

    expect(template).not.toMatch(/<script(?![^>]*\bsrc\s*=)[^>]*>/i)
    expect(template).not.toMatch(/<style[\s>]/i)
    expect(template).not.toMatch(/\son[a-z]+\s*=/i)
    expect(template).not.toMatch(/\sstyle\s*=/i)

    expect(template).not.toMatch(/<(?:script|img)\b[^>]*\bsrc\s*=\s*["']?(?:https?:)?\/\//i)
    expect(externallyFetchingLinks(template)).toEqual([])
  })
})
