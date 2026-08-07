import type { FastifyInstance } from 'fastify'

/**
 * The error envelope, enforced at boot rather than described in prose (#51).
 *
 * Every refusal in this app answers `{ "error": "<slug>" }`, and `sendError` is what
 * makes the status and the slug agree. But `sendError` calls `reply.send`, which goes
 * through the route's own response serializer — so a route that declares a schema
 * **for an error status** strips the envelope down to whatever that schema allows:
 *
 * ```ts
 * // Answers 400 {} — the envelope is gone
 * schema: { response: { 400: { type: 'object', properties: { detail: … } } } }
 * ```
 *
 * It is silent in both directions. No test fails, and the response is a
 * syntactically valid `{}` that the web client reads as `code: 'unknown'`.
 * Documentation is worst at preventing exactly this, which is why this is a hook.
 *
 * Declaring only a `200` is safe and stays safe; nothing here asks a route to
 * describe its errors, only to describe them honestly if it does.
 */

/** `4xx`, `5xx` and any numeric key from 400 up. `Number('4xx')` is `NaN`, hence both. */
const isErrorStatus = (key: string): boolean => key === '4xx' || key === '5xx' || Number(key) >= 400

/**
 * Whether a declared schema would let `{ "error": … }` through.
 *
 * Shape only, and deliberately shallow: this is not validating JSON Schema, it is
 * answering one question about a serializer that drops what it is not told about. A
 * schema with no `properties` at all — `{ type: 'object' }` — passes nothing through,
 * which is the case that produced `{}`.
 *
 * Exported so the rule can be tested without registering a route.
 */
export const admitsEnvelope = (schema: unknown): boolean => {
  if (typeof schema !== 'object' || schema === null) return false

  const properties = Reflect.get(schema, 'properties')
  if (typeof properties !== 'object' || properties === null) return false

  const error = Reflect.get(properties, 'error')

  return typeof error === 'object' && error !== null && Reflect.get(error, 'type') === 'string'
}

/**
 * Refuse to start if any route would strip the envelope off its own errors.
 *
 * `onRoute` fires as each route registers, so this has to be added before them — and
 * a throw from it comes out of the registration call, which is inside `createApp`.
 * The same shape as `assertServableWebRoot`: a container that will not start is far
 * easier to diagnose than one that starts and answers `400 {}`.
 */
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
