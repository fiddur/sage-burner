import type { FastifyInstance } from 'fastify'

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from './db/index.ts'

import { createApp } from './app.ts'
import { createConfig } from './config.ts'
import { createDb, runMigrations } from './db/index.ts'

/**
 * The headers a browser needs before a session cookie exists (#8) and before
 * invite links start arriving over Discord and Messenger (#17).
 *
 * Asserted on both an API response and the SPA shell, because the two take
 * different paths out of Fastify — the API through a route, the shell through
 * `@fastify/static` and the not-found handler — and a hook registered in the
 * wrong place covers only one of them.
 */

let handle: DbHandle | undefined
let app: FastifyInstance | undefined
let webRoot: string | undefined

const build = async (): Promise<FastifyInstance> => {
  webRoot = mkdtempSync(join(tmpdir(), 'sage-headers-'))
  mkdirSync(join(webRoot, 'assets'), { recursive: true })
  writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>x</title><div id="app"></div>')
  writeFileSync(join(webRoot, 'assets', 'index.js'), 'console.log(1)')

  handle = createDb({ url: ':memory:' })
  runMigrations(handle)
  app = await createApp({
    db: handle.db,
    // WEB_ROOT makes this deployment-shaped, so a secret is required.
    config: createConfig({ LOG_LEVEL: 'silent', SESSION_SECRET: 't'.repeat(40), WEB_ROOT: webRoot }),
  })
  return app
}

afterEach(async () => {
  // Nulled after closing: the second describe block never calls `build()`, and
  // without this its teardown closes the previous test's handle a second time.
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

/**
 * `<link>` tags that would fetch from another origin.
 *
 * Parsed rather than pattern-matched, because `rel` is a *token list* and the
 * distinctions matter in both directions. `rel="shortcut icon"` and
 * `rel="apple-touch-icon"` both fetch an image governed by `img-src`, so a
 * favicon pasted from a generator would break in the built app — and a regex
 * anchored at the start of the attribute value misses both. Meanwhile
 * `dns-prefetch` only resolves a name and `preconnect` only opens a connection;
 * neither fetches, so neither is CSP's business, and flagging them would fail a
 * legitimate edit with a message about an unrelated policy.
 */
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
    // Three different paths out of Fastify. A hook on the wrong one would leave
    // the HTML — the only response a browser parses — uncovered.
    const server = await build()

    for (const url of ['/api/version', '/some/client/route', '/assets/index.js']) {
      const response = await server.inject({ method: 'GET', url })

      expect(response.headers['x-content-type-options'], url).toBe('nosniff')
      expect(response.headers['referrer-policy'], url).toBe('no-referrer')
      expect(response.headers['content-security-policy'], url).toBeDefined()
    }
  })

  it('refuses to be framed at all, not merely by another origin', async () => {
    // Approving an application is one click, so clickjacking is the concern.
    // Helmet defaults to `'self'`/SAMEORIGIN; the app never frames itself.
    const server = await build()

    const response = await server.inject({ method: 'GET', url: '/' })

    expect(directives(String(response.headers['content-security-policy'])).get('frame-ancestors')).toEqual([
      "'none'",
    ])
    expect(response.headers['x-frame-options']).toBe('DENY')
  })

  it('leaks no referrer, since an invite token travels in the path', async () => {
    // #17 puts a single-use token at /invite/<token>. A member clicking any
    // outbound link from that page would otherwise hand the token to the
    // destination in the Referer header.
    expect(
      (await (await build()).inject({ method: 'GET', url: '/invite/abc' })).headers['referrer-policy'],
    ).toBe('no-referrer')
  })

  it('allows no inline script or style anywhere in the policy', async () => {
    // The whole point of checking the build output: it has no inline script and
    // no inline style, so the policy does not need the escape hatch that makes
    // CSP largely decorative. Helmet's default ships `'unsafe-inline'` on
    // style-src.
    const server = await build()

    const csp = (await server.inject({ method: 'GET', url: '/' })).headers['content-security-policy']

    // Asserted present first: `String(undefined)` contains neither escape
    // hatch, so a missing policy would pass the two checks below.
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
    // Both are overrides too — helmet ships `'self' https: data:` for font-src
    // and `'self'` for base-uri — and without these two lines they were the
    // only ones nothing would notice losing.
    expect(found.get('font-src')).toEqual(["'self'"])
    expect(found.get('base-uri')).toEqual(["'none'"])
    // The one directive deliberately wider than the rest, and the only override
    // that had nothing pinning it. Losing it is silent in *both* directions:
    // reverting to helmet's `'self' data:` still passes every test here and
    // breaks only remote images in production — the mismatch #69 existed to
    // remove. `markdown.ts` encodes the same list in `isSafeImageSource`, so
    // this is also what keeps the two from drifting apart.
    expect(found.get('img-src')).toEqual(["'self'", 'data:', 'https:'])
  })

  it('asks browsers to remember the TLS, which Apache terminates', async () => {
    expect(
      (await (await build()).inject({ method: 'GET', url: '/' })).headers['strict-transport-security'],
      // The exact value, not merely its presence: the README's apex-domain
      // warning is entirely about `includeSubDomains` and the one-year
      // max-age, and both come from helmet's defaults rather than from
      // `helmetOptions()`. A helmet upgrade shortening either would leave that
      // warning silently wrong with every test still green.
    ).toBe('max-age=31536000; includeSubDomains')
  })
})

describe('the CSP against the actual page it protects', () => {
  it('holds because the HTML entry point has nothing inline in it', async () => {
    // The assumption the policy rests on, pinned rather than trusted.
    //
    // Vite passes most of this file through untouched — checked, not assumed:
    // an inline `<script type="module">` is extracted into the entry chunk and
    // never reaches `dist/index.html`, but a classic inline `<script>`, a
    // `<style>` block, `on*=` and `style=` all survive verbatim. Any of those
    // would leave the built app silently broken in production: the policy
    // blocks it, and nothing else would fail. The module case is caught too,
    // which is stricter than necessary and the safe direction.
    const template = readFileSync(join(import.meta.dirname, '../../web/index.html'), 'utf8')

    // `src\s*=`, not `src=`, matching the sibling assertions: `<script src =
    // "…">` is valid HTML, and reporting it as an *inline* script would be the
    // same misleading failure the `fetchingRels` comment below avoids.
    expect(template).not.toMatch(/<script(?![^>]*\bsrc\s*=)[^>]*>/i)
    expect(template).not.toMatch(/<style[\s>]/i)
    expect(template).not.toMatch(/\son[a-z]+\s*=/i)
    expect(template).not.toMatch(/\sstyle\s*=/i)

    // The same trap through the other door: `script-src 'self'` blocks a CDN
    // just as surely as an inline block, and with the identical symptom —
    // broken only in the built app, with nothing else failing.
    //
    // Narrowed to the attributes that actually start a fetch CSP governs. A
    // blanket `src|href` scan would also reject `<link rel="canonical">`,
    // `rel="me"`, `rel="preconnect">` and any absolute `<a href>`, none of
    // which a policy can block — failing a legitimate edit with a message
    // about a policy that had nothing to do with it.
    //
    expect(template).not.toMatch(/<(?:script|img)\b[^>]*\bsrc\s*=\s*["']?(?:https?:)?\/\//i)
    expect(externallyFetchingLinks(template)).toEqual([])
  })
})
