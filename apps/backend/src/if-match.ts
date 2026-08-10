import type { FastifyReply, FastifyRequest } from 'fastify'

import { createHash } from 'node:crypto'

export const versionOf = (payload: unknown): string =>
  `"${createHash('sha256').update(JSON.stringify(payload)).digest('base64url')}"`

export const withVersion = <T>(reply: FastifyReply, payload: T): T => {
  void reply.header('etag', versionOf(payload))

  return payload
}

export const withCollectionVersion = async <T>(
  reply: FastifyReply,
  payload: T,
  collection: () => Promise<unknown>,
): Promise<T> => {
  void reply.header('etag', versionOf(await collection()))

  return payload
}

export const refuseIfStale = async <T extends object>(
  request: Pick<FastifyRequest, 'headers'>,
  reply: FastifyReply,
  current: () => Promise<T>,
): Promise<boolean> => {
  const quoted = request.headers['if-match']
  const payload = await current()
  const version = versionOf(payload)

  if (quoted === version) return false

  const missing = typeof quoted !== 'string' || quoted === ''

  void reply
    .code(missing ? 428 : 412)
    .header('etag', version)
    .send({ error: missing ? 'precondition_required' : 'stale', ...payload })

  return true
}
