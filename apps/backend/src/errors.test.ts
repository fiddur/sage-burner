import type { FastifyInstance } from 'fastify'

import Fastify from 'fastify'
import { connect } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from './db/index.ts'

import { createApp, loggerOptions } from './app.ts'
import { createConfig } from './config.ts'
import { createDb } from './db/index.ts'
import { frameworkErrorHandler, registerErrorHandler } from './errors.ts'

/**
 * What the error handler writes to the log, as opposed to what it writes to the
 * wire — `app.test.ts` covers the latter.
 *
 * Built on a bare Fastify instance rather than `createApp` so the log stream can
 * be captured: `createApp` builds its logger from config and has no seam for one.
 */

type LogLine = { msg: string; err?: { stack?: unknown } }

/**
 * Narrowed rather than cast, for the same reason `headersFrom` is: `JSON.parse`
 * returns `any`, so a cast here would assert a shape pino is merely expected to
 * produce, and a line that did not match would be read as one that did.
 */
const isLogLine = (value: unknown): value is LogLine =>
  typeof value === 'object' && value !== null && 'msg' in value && typeof value.msg === 'string'

const withCapturedLog = () => {
  const lines: LogLine[] = []
  const app = Fastify({
    logger: {
      level: 'info',
      stream: {
        write: (chunk: string) => {
          const parsed: unknown = JSON.parse(chunk)
          if (isLogLine(parsed)) lines.push(parsed)
        },
      },
    },
  })
  registerErrorHandler(app)
  return { app, lines }
}

describe('error logging', () => {
  let app: FastifyInstance | undefined
  let handle: DbHandle | undefined

  afterEach(async () => {
    await app?.close()
    handle?.close()
    app = undefined
    handle = undefined
  })

  const rejectionFor = async (thrown: unknown) => {
    const captured = withCapturedLog()
    app = captured.app
    captured.app.get('/boom', async () => {
      throw thrown
    })

    await captured.app.inject({ method: 'GET', url: '/boom' })

    return captured.lines.filter((line) => line.msg === 'request failed' || line.msg === 'request rejected')
  }

  it('logs a 4xx without a stack, so an unauthenticated caller cannot fill the disk', async () => {
    // `info` is the default LOG_LEVEL, so this branch runs in production. With
    // `{ err }` pino writes the full stack, and posting a malformed body in a
    // loop writes one per request.
    const [line] = await rejectionFor(Object.assign(new Error('body must be object'), { statusCode: 400 }))

    expect(line?.msg).toBe('request rejected')
    expect(JSON.stringify(line)).not.toContain('stack')
  })

  it('keeps the facts that make a 4xx line worth having', async () => {
    const [line] = await rejectionFor(
      Object.assign(new Error('body must be object'), { statusCode: 400, code: 'FST_ERR_VALIDATION' }),
    )

    expect(line).toMatchObject({
      status: 400,
      code: 'FST_ERR_VALIDATION',
      reason: 'body must be object',
    })
  })

  it('answers rather than dropping the connection when the framework path fails', async () => {
    // The two error paths do not share Fastify's safety net. `handleError`
    // wraps `setErrorHandler` in a catch that re-sends; `onBadUrl` calls
    // `frameworkErrors` bare, so an uncaught throw there leaves nothing on the
    // socket and takes the process down with an uncaughtException.
    //
    // A failing log destination is the injectable version of that. It fails on
    // every line this file writes — the 4xx line inside `sendEnvelope` and the
    // fallback's own error line — so the containment cannot pass by falling
    // back to a log that still works. It does not fail on Fastify's
    // `incoming request`, which is written before `onBadUrl` calls the handler
    // at all: failing that throws outside anything this file can catch, and
    // would test a case no fallback could survive.
    const failing = Fastify({
      logger: {
        level: 'info',
        stream: {
          write: (chunk: string) => {
            if (chunk.includes('rejected') || chunk.includes('handler failed')) {
              throw new Error('log destination gone')
            }
          },
        },
      },
      frameworkErrors: frameworkErrorHandler,
    })
    app = failing
    // find-my-way short-circuits to 404 with an empty route tree, so onBadUrl
    // never fires without at least one route to attempt a match against.
    failing.get('/thing', async () => ({ ok: true }))

    const response = await failing.inject({ method: 'GET', url: '/%zz' })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({ error: 'internal_error' })

    // What this pins is the ordering: logging before sending turns this into a
    // 5s timeout and an unhandled rejection. The try/catch around the fallback's
    // own log line is *not* pinned — that failure escapes as an
    // uncaughtException after the response is already out, so the status cannot
    // see it, and vitest installs its own uncaughtException handler ahead of any
    // this test could add. Verified out-of-band instead: unguarded, the same
    // scenario answers 500 and still raises one uncaughtException, which under
    // Node's default takes the process down with the connection intact.
  })

  it('keeps the envelope on the thrown path when logging fails', async () => {
    // The path with the actual traffic. `handleError` catches and re-sends, so
    // an unguarded throw here does not drop the connection — it answers
    // `{ statusCode, error: 'Internal Server Error', message: 'log destination
    // gone' }`, which is the one response this file exists to prevent, and it
    // would carry the failure's own message to the client.
    const failing = Fastify({
      logger: {
        level: 'info',
        stream: {
          write: (chunk: string) => {
            if (chunk.includes('rejected') || chunk.includes('handler failed')) {
              throw new Error('log destination gone')
            }
          },
        },
      },
    })
    app = failing
    registerErrorHandler(failing)
    failing.get('/refused', async () => {
      throw Object.assign(new Error('nope'), { statusCode: 403 })
    })

    const response = await failing.inject({ method: 'GET', url: '/refused' })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({ error: 'internal_error' })
    expect(response.body).not.toContain('log destination gone')
  })

  it('answers an oversized header block with the envelope, not Fastify prose', async () => {
    // The third error path, and the only one that needs a real socket:
    // `app.inject` skips Node's HTTP parser entirely, so nothing here is
    // reachable through it. The default writes
    // `{"error":"Request Header Fields Too Large",…}` — a sentence in the field
    // the envelope promises is a slug. Reachable without malice on a
    // cookie-session app once enough cookies accumulate on the domain.
    handle = createDb({ url: ':memory:' })
    const server = await createApp({
      db: handle.db,
      config: createConfig({ LOG_LEVEL: 'silent' }),
    })
    app = server
    await server.listen({ port: 0, host: '127.0.0.1' })
    const address = server.addresses()[0]
    if (address === undefined) throw new Error('no address')

    const raw = await new Promise<string>((resolve, reject) => {
      const socket = connect(address.port, '127.0.0.1', () => {
        socket.write(`GET /api/version HTTP/1.1\r\nHost: x\r\nCookie: ${'a'.repeat(24_000)}\r\n\r\n`)
      })
      let received = ''
      socket.setEncoding('utf8')
      socket.on('data', (chunk: string) => (received += chunk))
      socket.on('close', () => resolve(received))
      socket.on('error', reject)
    })

    expect(raw).toContain('431 Request Header Fields Too Large')
    expect(raw).toContain('{"error":"bad_request"}')
    expect(raw).not.toContain('"message"')
  })

  it('redacts credentials an error carried in its headers', async () => {
    // The 5xx branch logs `{ err }`, and pino's error serializer copies an
    // error's own enumerable properties — so the error-carried headers this
    // file deliberately supports (a session-clearing set-cookie, a challenge)
    // are also the shape that would write a live session value to disk.
    const lines: string[] = []
    const capturing = Fastify({
      logger: { ...loggerOptions('info'), stream: { write: (chunk: string) => void lines.push(chunk) } },
    })
    app = capturing
    registerErrorHandler(capturing)
    capturing.get('/boom', async () => {
      throw Object.assign(new Error('kaput'), {
        statusCode: 500,
        headers: {
          // Canonically cased on purpose. Naming redact paths
          // (`err.headers["set-cookie"]`) only matches the lowercase spelling,
          // and `Set-Cookie` is the one most libraries actually emit — so the
          // supported shape in its usual casing would sail past a by-name
          // control. These keys are the test.
          'Set-Cookie': ['session=SECRETVALUE; Path=/'],
          Authorization: 'Bearer SECRETTOKEN',
          Cookie: 'session=SECRETCOOKIE',
          'WWW-Authenticate': 'Bearer',
        },
      })
    })

    await capturing.inject({ method: 'GET', url: '/boom' })

    const logged = lines.join('')
    expect(logged).not.toContain('SECRETVALUE')
    expect(logged).not.toContain('SECRETTOKEN')
    expect(logged).not.toContain('SECRETCOOKIE')
    // The names survive, which is the part worth reading — "a challenge was
    // attached" without the value that must never be written down.
    expect(logged).toContain('WWW-Authenticate')
    expect(logged).toContain('sent_headers')
  })

  it('answers a non-object throw with the envelope, keeping the reply status', async () => {
    // `throw null` is legal, and reaches the handler with a status already on
    // the reply. Reading `error.code` off it threw, Fastify's catch re-sent
    // that as its prose envelope, and the 409 was lost — the one throw this
    // handler could not handle produced exactly what it exists to prevent.
    const captured = withCapturedLog()
    app = captured.app
    captured.app.get('/nothing', async (_request, reply) => {
      reply.code(409)
      // eslint-disable-next-line no-throw-literal
      throw null
    })

    const response = await captured.app.inject({ method: 'GET', url: '/nothing' })

    expect(response.statusCode).toBe(409)
    // `conflict` since #11 gave 409 its own code; the property under test is
    // that the status the route set survives a throw the handler cannot read,
    // not which code 409 maps to.
    expect(response.json()).toEqual({ error: 'conflict' })
  })

  it('logs a 5xx with the stack, which is ours to explain', async () => {
    const [line] = await rejectionFor(new Error('the database went away'))

    expect(line?.msg).toBe('request failed')
    expect(line?.err?.stack).toContain('the database went away')
  })
})
