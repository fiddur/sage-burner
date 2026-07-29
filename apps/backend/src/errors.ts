import type { ErrorCode, ErrorResponse } from '@sage-burner/shared'
import type { FastifyError, FastifyInstance } from 'fastify'

import { errorResponse } from '@sage-burner/shared'

/**
 * Map anything thrown into the documented error envelope.
 *
 * Without this, Fastify's built-in serializer answers with
 * `{ statusCode, error: 'Internal Server Error', message }` — which satisfies
 * `errorResponseSchema`, since `error` is a string, while putting a *sentence*
 * where the envelope promises a machine-readable slug. A client branching on
 * `code` would be branching on prose, and the message can carry internals: a
 * SQL fragment, a file path, a column name.
 *
 * So the response carries the code and nothing else, and the real error goes to
 * the log where it is useful and not public.
 */
const codeFor = (status: number): ErrorCode => {
  if (status === 404) return 'not_found'
  if (status >= 400 && status < 500) return 'bad_request'
  return 'internal_error'
}

export const registerErrorHandler = (app: FastifyInstance) => {
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    const status = error.statusCode ?? 500

    // 5xx is ours to explain; 4xx is the caller's mistake and would otherwise
    // fill the log with noise anyone can generate.
    if (status >= 500) {
      request.log.error({ err: error }, 'request failed')
    } else {
      request.log.info({ err: error, status }, 'request rejected')
    }

    const body: ErrorResponse = errorResponse(codeFor(status))
    return reply.code(status).send(body)
  })
}
