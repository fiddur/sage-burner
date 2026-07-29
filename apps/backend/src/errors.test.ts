import type { FastifyInstance } from 'fastify'

import Fastify from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'

import { registerErrorHandler } from './errors.ts'

/**
 * What the error handler writes to the log, as opposed to what it writes to the
 * wire — `app.test.ts` covers the latter.
 *
 * Built on a bare Fastify instance rather than `createApp` so the log stream can
 * be captured: `createApp` builds its logger from config and has no seam for one.
 */

type LogLine = { level: number; msg: string; stack?: string; err?: { stack?: string } }

const withCapturedLog = () => {
  const lines: LogLine[] = []
  const app = Fastify({
    logger: {
      level: 'info',
      stream: {
        write: (chunk: string) => {
          const parsed: unknown = JSON.parse(chunk)
          if (typeof parsed === 'object' && parsed !== null) lines.push(parsed as LogLine)
        },
      },
    },
  })
  registerErrorHandler(app)
  return { app, lines }
}

describe('error logging', () => {
  let app: FastifyInstance | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
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

  it('logs a 5xx with the stack, which is ours to explain', async () => {
    const [line] = await rejectionFor(new Error('the database went away'))

    expect(line?.msg).toBe('request failed')
    expect(line?.err?.stack).toContain('the database went away')
  })
})
