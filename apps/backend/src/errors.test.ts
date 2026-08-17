import type { FastifyInstance } from 'fastify'

import Fastify from 'fastify'
import { connect } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from './db/index.ts'

import { createApp, loggerOptions } from './app.ts'
import { createConfig } from './config.ts'
import { createDb } from './db/index.ts'
import { frameworkErrorHandler, registerErrorHandler } from './errors.ts'

type LogLine = { msg: string; err?: { stack?: unknown } }

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
    failing.get('/thing', async () => ({ ok: true }))

    const response = await failing.inject({ method: 'GET', url: '/%zz' })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({ error: 'internal_error' })
  })

  it('keeps the envelope on the thrown path when logging fails', async () => {
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
    expect(logged).toContain('WWW-Authenticate')
    expect(logged).toContain('sent_headers')
  })

  it('answers a non-object throw with the envelope, keeping the reply status', async () => {
    const captured = withCapturedLog()
    app = captured.app
    captured.app.get('/nothing', async (_request, reply) => {
      reply.code(409)
      // eslint-disable-next-line no-throw-literal
      throw null
    })

    const response = await captured.app.inject({ method: 'GET', url: '/nothing' })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ error: 'conflict' })
  })

  it('logs a 5xx with the stack, which is ours to explain', async () => {
    const [line] = await rejectionFor(new Error('the database went away'))

    expect(line?.msg).toBe('request failed')
    expect(line?.err?.stack).toContain('the database went away')
  })
})
