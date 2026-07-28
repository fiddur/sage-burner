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
})
