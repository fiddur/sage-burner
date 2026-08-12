import type { ErrorCode } from '@sage-burner/shared'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { z, ZodType } from 'zod'

import { errorResponse } from '@sage-burner/shared'

import { codeFor } from './errors.ts'

export const noStore = (reply: FastifyReply) => reply.header('cache-control', 'no-store')

export type ClientStatus = 400 | 401 | 403 | 404 | 409 | 415 | 429

export const sendError = (reply: FastifyReply, status: ClientStatus, code?: ErrorCode) =>
  reply.code(status).send(errorResponse(code ?? codeFor(status)))

export const bodyOf = <Schema extends ZodType>(
  schema: Schema,
  request: Pick<FastifyRequest, 'body'>,
): z.infer<Schema> | undefined => {
  const parsed = schema.safeParse(request.body)

  return parsed.success ? parsed.data : undefined
}
