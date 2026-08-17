import type { FastifyInstance } from 'fastify'

import { errorResponseSchema } from '@sage-burner/shared'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import type { DbHandle } from './db/index.ts'

import { createApp } from './app.ts'
import { createConfig } from './config.ts'
import { createDb, runMigrations } from './db/index.ts'
import { event, INSTALLATION_ID, installationBanner } from './db/schema.ts'

let handle: DbHandle
let app: FastifyInstance

const build = async (env: NodeJS.ProcessEnv = {}, changelog?: string) => {
  handle = createDb({ url: ':memory:' })
  runMigrations(handle)
  app = await createApp({
    db: handle.db,
    config: createConfig({ LOG_LEVEL: 'silent', SESSION_SECRET: 't'.repeat(40), ...env }),
    ...(changelog === undefined ? {} : { changelog }),
  })
  return app
}

afterEach(async () => {
  await app?.close()
  handle?.close()
})

describe('GET /api/changelog', () => {
  it('answers with the file as markdown, to anyone', async () => {
    await build({}, '# What is new\n\n## 2026-08-07\n\n- A Q&A per burn.\n')

    const response = await app.inject({ method: 'GET', url: '/api/changelog' })

    expect(response.statusCode).toBe(200)
    expect(response.json().markdown).toContain('A Q&A per burn.')
  })

  it('revalidates rather than being cached as fresh', async () => {
    await build({}, '# What is new\n')

    const response = await app.inject({ method: 'GET', url: '/api/changelog' })

    expect(response.headers['cache-control']).toBe('no-cache')
  })

  it('answers empty rather than 404 where the image has no changelog', async () => {
    await build({}, '')

    const response = await app.inject({ method: 'GET', url: '/api/changelog' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ markdown: '' })
  })

  it("reads the repository's own file when nothing is injected", async () => {
    await build()

    expect((await app.inject({ method: 'GET', url: '/api/changelog' })).json().markdown).toContain(
      '# 2026-08-07',
    )
  })
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
    await build({ DATABASE_URL: '/data/secret-location.sqlite' })

    const body = (await app.inject({ method: 'GET', url: '/api/version' })).json()

    expect(Object.keys(body)).toEqual(['build_sha'])
  })
})

describe('the error envelope', () => {
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

  it('preserves the status the error chose, and names the codes a client acts on', async () => {
    await build()
    app.get('/api/forbidden', async () => {
      throw Object.assign(new Error('nope'), { statusCode: 403 })
    })
    app.get('/api/unauthenticated', async () => {
      throw Object.assign(new Error('nope'), { statusCode: 401 })
    })

    const forbidden = await app.inject({ method: 'GET', url: '/api/forbidden' })
    const unauthenticated = await app.inject({ method: 'GET', url: '/api/unauthenticated' })

    expect(forbidden.statusCode).toBe(403)
    expect(forbidden.json()).toEqual({ error: 'forbidden' })
    expect(unauthenticated.statusCode).toBe(401)
    expect(unauthenticated.json()).toEqual({ error: 'unauthenticated' })
  })

  it('refuses to answer 2xx with an error body', async () => {
    await build()
    app.get('/api/sneaky', async () => {
      throw Object.assign(new Error('nope'), { statusCode: 200 })
    })

    const response = await app.inject({ method: 'GET', url: '/api/sneaky' })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({ error: 'internal_error' })
  })

  it('keeps a status the route set on the reply before throwing', async () => {
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

  it('carries a numeric Retry-After, which is how a thrown limit emits it', async () => {
    await build()
    app.get('/api/limited', async () => {
      throw Object.assign(new Error('slow down'), {
        statusCode: 429,
        headers: { 'retry-after': 30 },
      })
    })

    const response = await app.inject({ method: 'GET', url: '/api/limited' })

    expect(response.statusCode).toBe(429)
    expect(response.headers['retry-after']).toBe('30')
  })

  it('carries an array of set-cookie headers without collapsing them', async () => {
    await build()
    app.get('/api/stale-session', async () => {
      throw Object.assign(new Error('session expired'), {
        statusCode: 401,
        headers: { 'set-cookie': ['session=; Max-Age=0', 'csrf=; Max-Age=0'] },
      })
    })

    const response = await app.inject({ method: 'GET', url: '/api/stale-session' })

    expect(response.statusCode).toBe(401)
    expect(response.headers['set-cookie']).toEqual(['session=; Max-Age=0', 'csrf=; Max-Age=0'])
  })

  it('honours an error that declares `status` rather than `statusCode`', async () => {
    await build()
    app.get('/api/status-only', async () => {
      throw Object.assign(new Error('nope'), { status: 403 })
    })

    const response = await app.inject({ method: 'GET', url: '/api/status-only' })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'forbidden' })
  })

  it('ignores a declared status below 400 in favour of one the reply already set', async () => {
    await build()
    app.get('/api/mixed', async (_request, reply) => {
      reply.code(409)
      throw Object.assign(new Error('nope'), { status: 200, statusCode: 204 })
    })

    expect((await app.inject({ method: 'GET', url: '/api/mixed' })).statusCode).toBe(409)
  })

  it('clamps a status reply.code would reject rather than throwing inside the handler', async () => {
    await build()
    app.get('/api/absurd', async () => {
      throw Object.assign(new Error('nope'), { statusCode: 600 })
    })

    const response = await app.inject({ method: 'GET', url: '/api/absurd' })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({ error: 'internal_error' })
  })

  it('drops a content-type from the error, which would break serialization', async () => {
    await build()
    app.get('/api/mistyped', async () => {
      throw Object.assign(new Error('nope'), {
        statusCode: 400,
        headers: { 'content-type': 'text/html', 'x-request-id': 'abc' },
      })
    })

    const response = await app.inject({ method: 'GET', url: '/api/mistyped' })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'bad_request' })
    expect(response.headers['content-type']).toMatch(/application\/json/)
    expect(response.headers['x-request-id']).toBe('abc')
  })

  it('drops an encoding the envelope is not encoded with', async () => {
    await build()
    app.get('/api/encoded', async () => {
      throw Object.assign(new Error('nope'), {
        statusCode: 502,
        headers: {
          'content-encoding': 'gzip',
          'transfer-encoding': 'chunked',
          'x-request-id': 'abc',
        },
      })
    })

    const response = await app.inject({ method: 'GET', url: '/api/encoded' })

    expect(response.statusCode).toBe(502)
    expect(response.json()).toEqual({ error: 'internal_error' })
    expect(response.headers['content-encoding']).toBeUndefined()
    expect(response.headers['transfer-encoding']).toBeUndefined()
    expect(response.headers['x-request-id']).toBe('abc')
  })

  it('covers a bad url, which never reaches a route to throw from', async () => {
    await build()

    const response = await app.inject({ method: 'GET', url: '/api/%zz' })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'bad_request' })
  })

  it('keeps the status a framework error asked for rather than flattening it', async () => {
    await build()
    app.get('/api/thing/:id', async () => ({ ok: true }))
    await app.ready()

    const response = await app.inject({ method: 'GET', url: `/api/thing/${'x'.repeat(200)}` })

    expect(response.statusCode).toBe(414)
    expect(response.json()).toEqual({ error: 'bad_request' })
  })

  it('survives a route that declares only a success schema', async () => {
    await build()
    app.get(
      '/api/typed',
      { schema: { response: { 200: { type: 'object', properties: { ok: { type: 'boolean' } } } } } },
      async () => {
        throw Object.assign(new Error('nope'), { statusCode: 400 })
      },
    )

    const response = await app.inject({ method: 'GET', url: '/api/typed' })

    expect(response.json()).toEqual({ error: 'bad_request' })
  })

  it('survives a route that declares an error status, given the envelope schema', async () => {
    await build()
    app.get(
      '/api/detailed',
      { schema: { response: { 400: z.toJSONSchema(errorResponseSchema) } } },
      async () => {
        throw Object.assign(new Error('nope'), { statusCode: 400 })
      },
    )

    const response = await app.inject({ method: 'GET', url: '/api/detailed' })

    expect(response.json()).toEqual({ error: 'bad_request' })
  })

  it('maps a thrown 404 to not_found, not the generic 4xx code', async () => {
    await build()
    app.get('/api/gone', async () => {
      throw Object.assign(new Error('no such member'), { statusCode: 404 })
    })

    const response = await app.inject({ method: 'GET', url: '/api/gone' })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
  })
})

describe('trustProxy', () => {
  const whoami = async (env: NodeJS.ProcessEnv) => {
    await build(env)
    app.get('/api/whoami', async (request) => ({ ip: request.ip }))

    const response = await app.inject({
      method: 'GET',
      url: '/api/whoami',
      headers: { 'x-forwarded-for': '9.9.9.9, 203.0.113.7' },
      remoteAddress: '172.17.0.1',
    })
    return response.json()
  }

  it('trusts nothing by default, so a claimed address is ignored entirely', async () => {
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
    await build()

    const response = await app.inject({ method: 'GET', url: '/api/nope' })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
  })
})

const SHELL =
  '<!doctype html><html><head><title>Sage Burner</title>' +
  '<meta name="description" content="Membership and scheduling for a small co-created gathering." />' +
  '</head><body><div id="app"></div></body></html>'

describe('with a web root', () => {
  let webRoot: string

  beforeEach(() => {
    webRoot = mkdtempSync(join(tmpdir(), 'sage-burner-web-'))
    writeFileSync(join(webRoot, 'index.html'), SHELL)
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
    await build({ WEB_ROOT: webRoot })

    const response = await app.inject({ method: 'GET', url: '/assets/index-a1b2c3.js' })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('hashed')
  })

  it('caches hashed assets forever and the shell never', async () => {
    await build({ WEB_ROOT: webRoot })

    const asset = await app.inject({ method: 'GET', url: '/assets/index-a1b2c3.js' })
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable')

    const shell = await app.inject({ method: 'GET', url: '/index.html' })
    expect(shell.headers['cache-control']).toBe('no-cache')
  })

  it('does not cache the shell when an ancestor directory is named assets', async () => {
    const outer = mkdtempSync(join(tmpdir(), 'sage-burner-outer-'))
    const nested = join(outer, 'assets', 'app', 'dist')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(nested, 'index.html'), SHELL)

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
    await build({ WEB_ROOT: webRoot })

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
    await build({ WEB_ROOT: webRoot })

    const response = await app.inject({ method: 'GET', url: '/api/nope?x=1' })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
  })

  it('404s a percent-encoded API path rather than serving the shell', async () => {
    await build({ WEB_ROOT: webRoot })

    const response = await app.inject({ method: 'GET', url: '/%61pi/nope' })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
  })
})

describe('the share card in the shell (#306)', () => {
  let webRoot: string

  beforeEach(() => {
    webRoot = mkdtempSync(join(tmpdir(), 'sage-burner-card-'))
    writeFileSync(join(webRoot, 'index.html'), SHELL)
  })

  afterEach(() => {
    rmSync(webRoot, { recursive: true, force: true })
  })

  const givenBurn = async (overrides: Partial<typeof event.$inferInsert> = {}) => {
    await handle.db.insert(event).values({
      id: randomUUID(),
      name: 'Autumn Burn',
      slug: 'autumn-2030',
      start_date: '2030-10-02',
      end_date: '2030-10-04',
      location: 'Sagegården',
      welcome_markdown: '# Welcome\n\nFiery weekend burn.',
      member_cap: 42,
      created_at: new Date().toISOString(),
      ...overrides,
    })
  }

  const givenBanner = async () => {
    await handle.db.insert(installationBanner).values({
      id: INSTALLATION_ID,
      image: Buffer.from('not really a jpeg'),
      updated_at: '2026-08-07T10:00:00.000Z',
    })
  }

  const shellAt = async (url: string, headers: Record<string, string> = {}) =>
    (await app.inject({ method: 'GET', url, headers })).body

  it('names the open burn in the title, where a crawler reads it', async () => {
    await build({ WEB_ROOT: webRoot })
    await givenBurn()

    expect(await shellAt('/')).toContain('<title>Autumn Burn · Sage Burner</title>')
  })

  it('says the same on a client-side route as at the root', async () => {
    await build({ WEB_ROOT: webRoot })
    await givenBurn()

    const [root, deep] = [await shellAt('/'), await shellAt('/apply')]

    expect(deep).toContain('property="og:title" content="Autumn Burn · Sage Burner"')
    expect(deep).toBe(root)
  })

  it('leaves exactly one title and no description of the software', async () => {
    await build({ WEB_ROOT: webRoot })
    await givenBurn()

    const body = await shellAt('/')

    expect(body.match(/<title>/g)).toHaveLength(1)
    expect(body).not.toContain('Membership and scheduling for a small co-created gathering.')
    expect(body).toContain('property="og:description" content="2030-10-02 – 2030-10-04 · Sagegården ·')
  })

  it('falls back to the installation when no burn is open', async () => {
    await build({ WEB_ROOT: webRoot })

    const body = await shellAt('/')

    expect(body).toContain('<title>Sage Burner</title>')
    expect(body).toContain('property="og:type" content="website"')
    expect(body).not.toContain('og:description')
  })

  it('points the card at the banner when one has been uploaded', async () => {
    await build({ WEB_ROOT: webRoot })
    await givenBurn()
    await givenBanner()

    const body = await shellAt('/', { host: 'burn.example.org' })

    expect(body).toContain(
      'property="og:image" content="http://burn.example.org/api/installation/banner' +
        '?v=2026-08-07T10%3A00%3A00.000Z"',
    )
    expect(body).toContain('name="twitter:card" content="summary_large_image"')
  })

  it('falls back to the app icon, and to the small card with it', async () => {
    await build({ WEB_ROOT: webRoot })
    await givenBurn()

    const body = await shellAt('/', { host: 'burn.example.org' })

    expect(body).toContain('property="og:image" content="http://burn.example.org/api/installation/icon')
    expect(body).toContain('name="twitter:card" content="summary"')
  })

  it('takes the origin from the request, since the app has no notion of its own', async () => {
    await build({ WEB_ROOT: webRoot })
    await givenBurn()

    expect(await shellAt('/', { host: 'burn.example.org' })).toContain(
      'property="og:url" content="http://burn.example.org"',
    )
  })

  it('lets PUBLIC_ORIGIN win, which is also the https a proxy terminates', async () => {
    await build({ WEB_ROOT: webRoot, PUBLIC_ORIGIN: 'https://burn.example.org' })
    await givenBurn()

    expect(await shellAt('/', { host: 'whatever.invalid' })).toContain(
      'property="og:url" content="https://burn.example.org"',
    )
  })

  it('leaves the absolute tags out rather than believing a bent Host', async () => {
    await build({ WEB_ROOT: webRoot })
    await givenBurn()

    const body = await shellAt('/', { host: 'burn.example.org/"><script>x</script>' })

    expect(body).not.toContain('og:url')
    expect(body).not.toContain('og:image')
    expect(body).toContain('<title>Autumn Burn · Sage Burner</title>')
  })

  it('carries the structured data Google reads, dates and all', async () => {
    await build({ WEB_ROOT: webRoot })
    await givenBurn({ start_time: '15:00', end_time: '14:00' })

    const body = await shellAt('/')

    expect(body).toContain('"@type":"Event"')
    expect(body).toContain('"startDate":"2030-10-02T15:00"')
    expect(body).toContain('"endDate":"2030-10-04T14:00"')
    expect(body).toContain('"location":{"@type":"Place","name":"Sagegården"}')
  })

  it('serves the shell as HTML, not as a download', async () => {
    await build({ WEB_ROOT: webRoot })

    for (const url of ['/', '/index.html', '/apply']) {
      const response = await app.inject({ method: 'GET', url })

      expect(response.statusCode, url).toBe(200)
      expect(response.headers['content-type'], url).toContain('text/html')
    }
  })
})

describe('a web root that cannot serve the app', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sage-burner-badroot-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const buildWith = (webRoot: string) => {
    handle = createDb({ url: ':memory:' })
    runMigrations(handle)
    return createApp({
      db: handle.db,
      config: createConfig({ LOG_LEVEL: 'silent', SESSION_SECRET: 't'.repeat(40), WEB_ROOT: webRoot }),
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

  it('refuses to start on a shell it cannot put the share card into', async () => {
    writeFileSync(join(dir, 'index.html'), '<!doctype html><div id="app"></div>')

    await expect(buildWith(dir)).rejects.toThrow(/<\/head>/i)
  })
})
