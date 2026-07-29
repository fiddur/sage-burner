import type { FastifyInstance } from 'fastify'

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { DbHandle } from './db/index.ts'

import { createApp } from './app.ts'
import { createConfig } from './config.ts'
import { createDb, runMigrations } from './db/index.ts'

/**
 * Builds the real app in-process against an in-memory database and drives it
 * with `app.inject()` — no socket, no port, nothing to leak between tests.
 */

let handle: DbHandle
let app: FastifyInstance

const build = async (env: NodeJS.ProcessEnv = {}) => {
  handle = createDb({ url: ':memory:' })
  runMigrations(handle)
  app = await createApp({ db: handle.db, config: createConfig({ LOG_LEVEL: 'silent', ...env }) })
  return app
}

afterEach(async () => {
  await app?.close()
  handle?.close()
})

describe('GET /api/version', () => {
  it('reports the build it was made from', async () => {
    await build({ BUILD_SHA: 'abc123' })

    const response = await app.inject({ method: 'GET', url: '/api/version' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ build_sha: 'abc123' })
  })

  it('answers on a default environment, so the healthcheck works unconfigured', async () => {
    await build()

    const response = await app.inject({ method: 'GET', url: '/api/version' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ build_sha: 'unknown' })
  })

  it('exposes nothing beyond the build sha', async () => {
    // Reachable by anything that can reach the container, so it must not leak
    // the environment, the database path or dependency versions.
    await build({ DATABASE_URL: '/data/secret-location.sqlite' })

    const body = (await app.inject({ method: 'GET', url: '/api/version' })).json()

    expect(Object.keys(body)).toEqual(['build_sha'])
  })
})

describe('the error envelope', () => {
  // Without a setErrorHandler, Fastify answers a throw with
  // `{ statusCode, error: 'Internal Server Error', message }` — which satisfies
  // errorResponseSchema, since `error` is a string, while putting a sentence
  // where the envelope promises a slug. A client branching on `code` would be
  // branching on prose, and `message` can carry internals.
  it('maps a thrown error to the envelope, leaking nothing', async () => {
    await build()
    app.get('/api/boom', async () => {
      throw new Error('database password is hunter2')
    })

    const response = await app.inject({ method: 'GET', url: '/api/boom' })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({ error: 'internal_error' })
    expect(response.body).not.toContain('hunter2')
    expect(response.body).not.toContain('Internal Server Error')
  })

  it('maps a malformed JSON body to the envelope rather than Fastify prose', async () => {
    await build()
    app.post('/api/things', async () => ({ ok: true }))

    const response = await app.inject({
      method: 'POST',
      url: '/api/things',
      headers: { 'content-type': 'application/json' },
      payload: '{ not json',
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'bad_request' })
  })

  it('preserves the status the error chose, and maps 4xx to bad_request', async () => {
    await build()
    app.get('/api/forbidden', async () => {
      throw Object.assign(new Error('nope'), { statusCode: 403 })
    })

    const response = await app.inject({ method: 'GET', url: '/api/forbidden' })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'bad_request' })
  })

  it('refuses to answer 2xx with an error body', async () => {
    // The one shape the envelope must never take: createApiClient checks
    // `response.ok`, so a 200 carrying { error: … } skips the error path
    // entirely and is handed to the caller as the payload.
    await build()
    app.get('/api/sneaky', async () => {
      throw Object.assign(new Error('nope'), { statusCode: 200 })
    })

    const response = await app.inject({ method: 'GET', url: '/api/sneaky' })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({ error: 'internal_error' })
  })

  it('keeps a status the route set on the reply before throwing', async () => {
    // Fastify's default handler preserves this; replacing it would discard it.
    await build()
    app.get('/api/conflict', async (_request, reply) => {
      reply.code(409)
      throw new Error('already exists')
    })

    expect((await app.inject({ method: 'GET', url: '/api/conflict' })).statusCode).toBe(409)
  })

  it('carries error headers through, which a 401 challenge will need', async () => {
    await build()
    app.get('/api/challenge', async () => {
      throw Object.assign(new Error('nope'), {
        statusCode: 401,
        headers: { 'www-authenticate': 'Bearer' },
      })
    })

    const response = await app.inject({ method: 'GET', url: '/api/challenge' })

    expect(response.statusCode).toBe(401)
    expect(response.headers['www-authenticate']).toBe('Bearer')
  })
})

describe('trustProxy', () => {
  // Nothing else pins this: delete `trustProxy` from the Fastify options and
  // every other test in this file still passes while the spoof-resistance the
  // README argues for is silently gone. request.ip is what a rate limiter on
  // invite redemption and an admin audit trail will key on.
  //
  // Verified by deleting the option: the `1` and `true` cases fail. The default
  // case does *not*, because Fastify's own default is already `false` — so that
  // one documents the intended behaviour rather than pinning our choice of it.
  // Worth knowing before treating it as a guard.
  const whoami = async (env: NodeJS.ProcessEnv) => {
    await build(env)
    app.get('/api/whoami', async (request) => ({ ip: request.ip }))

    const response = await app.inject({
      method: 'GET',
      url: '/api/whoami',
      // A client claiming 9.9.9.9, with Apache having appended what it saw.
      headers: { 'x-forwarded-for': '9.9.9.9, 203.0.113.7' },
      remoteAddress: '172.17.0.1',
    })
    return response.json()
  }

  it('trusts nothing by default, so a claimed address is ignored entirely', async () => {
    // The more valuable half: an unconfigured deployment must not believe the
    // header at all.
    expect(await whoami({})).toEqual({ ip: '172.17.0.1' })
  })

  it('with one hop, takes what the proxy appended and ignores what the client prepended', async () => {
    expect(await whoami({ TRUST_PROXY: '1' })).toEqual({ ip: '203.0.113.7' })
  })

  it('with `true`, believes the whole chain — which is why it is not the default', async () => {
    expect(await whoami({ TRUST_PROXY: 'true' })).toEqual({ ip: '9.9.9.9' })
  })
})

describe('without a web root', () => {
  it('404s an unknown path rather than pretending to be an SPA', async () => {
    await build()

    const response = await app.inject({ method: 'GET', url: '/some/client/route' })

    expect(response.statusCode).toBe(404)
  })

  it('gives the API the same 404 body it gives when serving the web app', async () => {
    // WEB_ROOT is unset in development and set in the container. If the body
    // differed, frontend error handling written against one shape would meet
    // the other in the environment it was never tested in — and Fastify's
    // default also echoes the method and path back, which the terse body
    // deliberately avoids.
    await build()

    const response = await app.inject({ method: 'GET', url: '/api/nope' })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
  })
})

describe('with a web root', () => {
  let webRoot: string

  beforeEach(() => {
    webRoot = mkdtempSync(join(tmpdir(), 'sage-burner-web-'))
    writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>Sage Burner</title>')
    writeFileSync(join(webRoot, 'app.js'), 'console.info("hi")')
    mkdirSync(join(webRoot, 'assets'))
    writeFileSync(join(webRoot, 'assets', 'index-a1b2c3.js'), 'export const hashed = true')
  })

  afterEach(() => {
    rmSync(webRoot, { recursive: true, force: true })
  })

  it('serves a real asset', async () => {
    await build({ WEB_ROOT: webRoot })

    const response = await app.inject({ method: 'GET', url: '/app.js' })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('console.info')
  })

  it('serves a nested asset, which is the shape every Vite build emits', async () => {
    // Non-obvious property of `wildcard: false`: @fastify/static globs `**/**`
    // at registration and registers a route per file, so subdirectories work.
    // Without this test a regression breaking nested serving entirely would
    // leave the file green, since only the negative cases cover subpaths.
    await build({ WEB_ROOT: webRoot })

    const response = await app.inject({ method: 'GET', url: '/assets/index-a1b2c3.js' })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('hashed')
  })

  it('caches hashed assets forever and the shell never', async () => {
    // The shell points at the current hashes, so caching it is how a client
    // gets pinned to a build that no longer exists — and Watchtower redeploys
    // on its own schedule, so nobody is there to notice.
    await build({ WEB_ROOT: webRoot })

    const asset = await app.inject({ method: 'GET', url: '/assets/index-a1b2c3.js' })
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable')

    const shell = await app.inject({ method: 'GET', url: '/index.html' })
    expect(shell.headers['cache-control']).toBe('no-cache')
  })

  it('does not cache the shell when an ancestor directory is named assets', async () => {
    // A substring test against the absolute path would match here and hand the
    // shell `immutable` — which no redeploy can bust, pinning every client
    // that loaded it to a dead build for a year.
    const outer = mkdtempSync(join(tmpdir(), 'sage-burner-outer-'))
    const nested = join(outer, 'assets', 'app', 'dist')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(nested, 'index.html'), '<!doctype html><title>Sage Burner</title>')

    try {
      await build({ WEB_ROOT: nested })

      const shell = await app.inject({ method: 'GET', url: '/index.html' })
      expect(shell.headers['cache-control']).toBe('no-cache')

      const fallback = await app.inject({ method: 'GET', url: '/schedule' })
      expect(fallback.headers['cache-control']).toBe('no-cache')
    } finally {
      rmSync(outer, { recursive: true, force: true })
    }
  })

  it('keeps the shell uncached on the SPA fallback path too', async () => {
    // The path real navigations take. It reaches the shell through
    // `reply.sendFile` rather than a registered route, so the header applying
    // there is a non-obvious property of @fastify/static rather than something
    // this code arranges — worth pinning, since caching the shell is what pins
    // clients to a build that no longer exists.
    await build({ WEB_ROOT: webRoot })

    const response = await app.inject({ method: 'GET', url: '/schedule' })

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-cache')
  })

  it('serves the shell at the root', async () => {
    await build({ WEB_ROOT: webRoot })

    const response = await app.inject({ method: 'GET', url: '/' })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('Sage Burner')
  })

  it('serves the shell for a client-side route so deep links work', async () => {
    await build({ WEB_ROOT: webRoot })

    const response = await app.inject({ method: 'GET', url: '/invite/some-token' })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('Sage Burner')
  })

  it('still answers the API rather than shadowing it with static files', async () => {
    await build({ WEB_ROOT: webRoot, BUILD_SHA: 'abc123' })

    const response = await app.inject({ method: 'GET', url: '/api/version' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ build_sha: 'abc123' })
  })

  it('404s an unknown API path instead of returning the SPA shell', async () => {
    // Handing HTML to a fetch() expecting JSON turns a clear 404 into a
    // confusing parse error at the caller.
    await build({ WEB_ROOT: webRoot })

    const response = await app.inject({ method: 'GET', url: '/api/nope' })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
  })

  it('does not treat a path merely starting with "api" as an API path', async () => {
    await build({ WEB_ROOT: webRoot })

    const response = await app.inject({ method: 'GET', url: '/apiary' })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('Sage Burner')
  })

  it('404s a POST to an unknown path rather than serving a page', async () => {
    await build({ WEB_ROOT: webRoot })

    const response = await app.inject({ method: 'POST', url: '/not/a/thing' })

    expect(response.statusCode).toBe(404)
  })

  it('404s a missing asset instead of handing back the HTML shell', async () => {
    // Vite emits content-hashed chunks and Watchtower swaps the image under
    // live clients, so a page on the previous build asks for a chunk that no
    // longer exists. Answering with the shell and a 200 produces "Expected a
    // JavaScript module script but the server responded with a MIME type of
    // text/html", which is far worse to debug than a 404.
    await build({ WEB_ROOT: webRoot })

    // A hash from the *previous* build — the fixture only has index-a1b2c3.js.
    const response = await app.inject({ method: 'GET', url: '/assets/index-0ldbu1.js' })

    expect(response.statusCode).toBe(404)
    expect(response.headers['content-type']).toContain('application/json')
  })

  it('404s any missing file with an extension, not just scripts', async () => {
    await build({ WEB_ROOT: webRoot })

    for (const url of ['/missing.css', '/favicon.ico', '/img/logo.svg']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(404)
    }
  })

  it('serves the shell for a client route even with a query string', async () => {
    await build({ WEB_ROOT: webRoot })

    const response = await app.inject({ method: 'GET', url: '/invite/tok?from=discord' })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('Sage Burner')
  })

  it('404s an API path carrying a query string rather than serving the shell', async () => {
    // request.url includes the query string, so matching on it raw would let
    // `/api/nope?x=1` fall through to the SPA branch.
    await build({ WEB_ROOT: webRoot })

    const response = await app.inject({ method: 'GET', url: '/api/nope?x=1' })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
  })

  it('404s a percent-encoded API path rather than serving the shell', async () => {
    // `/%61pi/nope` is `/api/nope`. Matching the raw path would hand back HTML
    // and make the "an API path is never the SPA shell" rule not quite true.
    await build({ WEB_ROOT: webRoot })

    const response = await app.inject({ method: 'GET', url: '/%61pi/nope' })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
  })
})

describe('a web root that cannot serve the app', () => {
  // Setting WEB_ROOT states an intent to serve the frontend. Failing to do so
  // must stop the boot: /api/version would keep answering, so the container
  // healthcheck stays green while every page 404s — which is what a typo'd
  // variable, an unmounted volume, or a missing web build all look like.
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sage-burner-badroot-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  // `handle` is the shared one, so the outer afterEach closes the database.
  // No Fastify instance needs closing: createApp throws before returning, so
  // there is nothing constructed to leak — that is the property under test.
  const buildWith = (webRoot: string) => {
    handle = createDb({ url: ':memory:' })
    runMigrations(handle)
    return createApp({
      db: handle.db,
      config: createConfig({ LOG_LEVEL: 'silent', WEB_ROOT: webRoot }),
    })
  }

  it('refuses to start when the directory does not exist', async () => {
    await expect(buildWith(join(dir, 'nope'))).rejects.toThrow(/does not exist/i)
  })

  it('refuses to start when the path is a file', async () => {
    const file = join(dir, 'a-file')
    writeFileSync(file, 'not a directory')

    await expect(buildWith(file)).rejects.toThrow(/not a directory/i)
  })

  it('refuses to start when there is no index.html to serve', async () => {
    await expect(buildWith(dir)).rejects.toThrow(/index\.html/i)
  })
})
