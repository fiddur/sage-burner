import type { ErrorCode, ErrorResponse } from '@sage-burner/shared'
import type {
  ConnectionError,
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  FastifyServerOptions,
} from 'fastify'
import type { Socket } from 'node:net'

import { errorResponse } from '@sage-burner/shared'
import { STATUS_CODES } from 'node:http'

type HeaderValue = number | string | string[]

const describesTheBody = new Set(['content-type', 'content-length', 'content-encoding', 'transfer-encoding'])

const headersFrom = (error: unknown): Record<string, HeaderValue> | undefined => {
  if (typeof error !== 'object' || error === null || !('headers' in error)) return undefined

  const { headers } = error
  if (typeof headers !== 'object' || headers === null) return undefined

  const usable: Record<string, HeaderValue> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (describesTheBody.has(name.toLowerCase())) continue

    if (typeof value === 'string' || typeof value === 'number') {
      usable[name] = value
    } else if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
      usable[name] = value
    }
  }

  return Object.keys(usable).length > 0 ? usable : undefined
}

const declaredStatus = (error: unknown): number | undefined => {
  if (typeof error !== 'object' || error === null) return undefined

  const usable = (value: unknown) => (typeof value === 'number' && value >= 400 ? value : undefined)
  const fromStatus = 'status' in error ? usable(error.status) : undefined

  return fromStatus ?? ('statusCode' in error ? usable(error.statusCode) : undefined)
}

const detailsOf = (error: unknown): { code?: string; reason?: string } => {
  if (typeof error !== 'object' || error === null) {
    return typeof error === 'string' ? { reason: error } : {}
  }

  const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined
  const reason = 'message' in error && typeof error.message === 'string' ? error.message : undefined

  return { code, reason }
}

export const codeFor = (status: number): ErrorCode => {
  if (status === 401) return 'unauthenticated'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 409) return 'conflict'
  if (status === 412) return 'stale'
  if (status === 428) return 'precondition_required'
  if (status === 429) return 'rate_limited'
  if (status >= 400 && status < 500) return 'bad_request'
  return 'internal_error'
}

const sendEnvelope = (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
  const fromReply = reply.statusCode >= 400 ? reply.statusCode : undefined
  const chosen = declaredStatus(error) ?? fromReply ?? 500
  const status = chosen <= 599 ? chosen : 500

  const headers = headersFrom(error)

  if (status >= 500) {
    request.log.error({ err: error, sent_headers: headers && Object.keys(headers) }, 'request failed')
  } else {
    request.log.info({ ...detailsOf(error), status }, 'request rejected')
  }

  if (headers !== undefined) void reply.headers(headers)

  const body: ErrorResponse = errorResponse(codeFor(status))
  return reply.code(status).send(body)
}

export const clientErrorHandler = (error: ConnectionError, socket: Socket) => {
  if (error.code === 'ECONNRESET' || socket.destroyed) return

  const status =
    error.code === 'ERR_HTTP_REQUEST_TIMEOUT' ? 408 : error.code === 'HPE_HEADER_OVERFLOW' ? 431 : 400
  const body = JSON.stringify(errorResponse(codeFor(status)))

  if (socket.writable) {
    socket.write(
      `HTTP/1.1 ${status} ${STATUS_CODES[status] ?? 'Bad Request'}\r\n` +
        `Content-Length: ${Buffer.byteLength(body)}\r\n` +
        'Content-Type: application/json\r\n\r\n' +
        body,
    )
  }

  socket.destroy(error)
}

const sendLastResort = (request: FastifyRequest, reply: FastifyReply, failure: unknown) => {
  void reply.code(500).send(errorResponse('internal_error'))

  try {
    request.log.error({ err: failure }, 'framework error handler failed')
  } catch {}
}

const sendEnvelopeGuarded = (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
  try {
    sendEnvelope(error, request, reply)
  } catch (failure) {
    sendLastResort(request, reply, failure)
  }
}

export const registerErrorHandler = (app: FastifyInstance) => {
  app.setErrorHandler<FastifyError>(sendEnvelopeGuarded)
}

export const frameworkErrorHandler: NonNullable<FastifyServerOptions['frameworkErrors']> = sendEnvelopeGuarded
