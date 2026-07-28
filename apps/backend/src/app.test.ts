import type { FastifyInstance } from 'fastify'

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

    const response = await app.inject({ method: 'GET', url: '/assets/index-a1b2c3.js' })

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
})
