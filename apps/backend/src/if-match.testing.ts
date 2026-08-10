import type { LightMyRequestResponse } from 'fastify'

export const sendGuarded = async (
  send: (extraHeaders: Record<string, string>) => Promise<LightMyRequestResponse>,
): Promise<LightMyRequestResponse> => {
  const asked = await send({})
  if (asked.statusCode !== 428) return asked

  const version = asked.headers.etag

  return typeof version === 'string' ? send({ 'if-match': version }) : asked
}
