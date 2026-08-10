import type { FastifyInstance } from 'fastify'

const isErrorStatus = (key: string): boolean => key === '4xx' || key === '5xx' || Number(key) >= 400

export const admitsEnvelope = (schema: unknown): boolean => {
  if (typeof schema !== 'object' || schema === null) return false

  const properties = Reflect.get(schema, 'properties')
  if (typeof properties !== 'object' || properties === null) return false

  const error = Reflect.get(properties, 'error')

  return typeof error === 'object' && error !== null && Reflect.get(error, 'type') === 'string'
}

export const refuseEnvelopeStrippers = (app: FastifyInstance): void => {
  app.addHook('onRoute', (route) => {
    const response = Reflect.get(route.schema ?? {}, 'response')
    if (typeof response !== 'object' || response === null) return

    for (const [status, schema] of Object.entries(response)) {
      if (!isErrorStatus(status) || admitsEnvelope(schema)) continue

      throw new Error(
        `${String(route.method)} ${route.url} declares a ${status} response schema that would ` +
          'strip the error envelope. Either drop it or let it through `error: { type: "string" }`.',
      )
    }
  })
}
