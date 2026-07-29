import type { ErrorCode, ErrorResponse } from '@sage-burner/shared'
import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  FastifyServerOptions,
} from 'fastify'

import { errorResponse } from '@sage-burner/shared'

/**
 * Mapping anything thrown into the documented error envelope.
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

/** Header values Node's `setHeader` accepts, which is what `reply.headers` forwards to. */
type HeaderValue = number | string | string[]

/**
 * Headers that belong to the body being replaced, never to the error carrying
 * them. The encodings are here for the same reason as `content-type` rather
 * than for a known trigger: an error declaring `gzip` would put that on a
 * plaintext envelope, and the client would fail to gunzip a body that was never
 * compressed.
 *
 * Three of the four are pinned by tests — removing them turns `app.test.ts`
 * red. `content-length` cannot be: Fastify recomputes it in `onSendEnd`, so a
 * stale one never reaches the wire and there is nothing to observe. It stays in
 * the set because it describes the replaced body like the rest, not because it
 * is load-bearing.
 */
const describesTheBody = new Set(['content-type', 'content-length', 'content-encoding', 'transfer-encoding'])

/**
 * Headers an error asked to be sent with it.
 *
 * `FastifyError` does not declare `headers`, but Fastify's own default handler
 * passes it to `reply.headers` untouched — so this narrows rather than casting,
 * and accepts everything that call can carry. Filtering to strings would drop
 * the numeric `Retry-After` a rate limiter emits, silently, which is precisely
 * one of the cases this function exists for.
 */
const headersFrom = (error: unknown): Record<string, HeaderValue> | undefined => {
  if (typeof error !== 'object' || error === null || !('headers' in error)) return undefined

  const { headers } = error
  if (typeof headers !== 'object' || headers === null) return undefined

  const usable: Record<string, HeaderValue> = {}
  for (const [name, value] of Object.entries(headers)) {
    // Both describe a body that is about to be replaced by the envelope.
    // `content-type` is not merely stale: `handleError` deletes it before
    // calling a custom handler so serialization can be re-guessed, and putting
    // back a non-JSON one makes `reply.send` skip serialization and hand
    // `onSendEnd` an object — which fails as FST_ERR_REP_INVALID_PAYLOAD_TYPE
    // into Fastify's prose envelope, losing the status the error asked for.
    // The default handler is immune because it always serializes to a string.
    if (describesTheBody.has(name.toLowerCase())) continue

    if (typeof value === 'string' || typeof value === 'number') {
      usable[name] = value
    } else if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
      usable[name] = value
    }
  }

  return Object.keys(usable).length > 0 ? usable : undefined
}

/**
 * The status an error asked for, if it asked for a usable one.
 *
 * Either field is honoured only when it is already an error status. Some
 * middleware sets `status` alone; reading `statusCode` by itself would answer
 * 500 to an error that plainly said 403, and log it as ours rather than the
 * caller's. A declared 2xx is ignored rather than sent, because the envelope
 * with an ok status is the one shape it must never take — the web client
 * checks `response.ok` and would hand `{ error: … }` back as the payload.
 *
 * `status` wins over `statusCode`, which is one ordering where Fastify has
 * two. `setErrorHeaders` reads `status` first; `setErrorStatusCode`, which
 * runs immediately after it, reads `statusCode` first — and because the first
 * writes `res.statusCode` directly rather than through `reply.code()`,
 * `kReplyHasStatusCode` stays false and the second overwrites it. So the
 * effective default is `status`-first when the route set a status of its own
 * and `statusCode`-first when it did not. This picks `status` first
 * throughout: it matches the default in the case that has a route behind it,
 * and the divergence needs an error carrying both fields, both >= 400 and
 * different, which nothing in the tree emits.
 *
 * Deliberately stricter than the default in one respect: Fastify compares
 * loosely, so `status: '403'` passes `>= 400` there and becomes a 500 here.
 * A status is a number.
 */
const declaredStatus = (error: unknown): number | undefined => {
  if (typeof error !== 'object' || error === null) return undefined

  // Spelled out rather than looped over: `in` narrows on a literal key, not on
  // a union of them, and a loop would need a cast to read the field back.
  const usable = (value: unknown) => (typeof value === 'number' && value >= 400 ? value : undefined)
  const fromStatus = 'status' in error ? usable(error.status) : undefined

  return fromStatus ?? ('statusCode' in error ? usable(error.statusCode) : undefined)
}

const codeFor = (status: number): ErrorCode => {
  if (status === 404) return 'not_found'
  if (status >= 400 && status < 500) return 'bad_request'
  return 'internal_error'
}

/**
 * Answer with the envelope, whatever was thrown.
 *
 * Shared by the two paths that can fail, because they are separate options in
 * Fastify and only one of them is the obvious one.
 *
 * One trap this cannot close from here: the `send` below goes through the
 * route's response serializer, so a route declaring a schema *for an error
 * status* strips the envelope down to whatever that schema allows — a route
 * with a `{ detail }` 400 schema answers `400 {}`, not `{ error:
 * 'bad_request' }`, on exactly the path this exists to guarantee.
 *
 * Declaring only a success shape is safe: with a 200 schema and no 400 schema
 * the envelope passes through untouched, which is the case a route is actually
 * likely to have. The fix for the other case is to include
 * `z.toJSONSchema(errorResponseSchema)` under each error status the route
 * declares. Both halves are pinned in `app.test.ts`.
 */
const sendEnvelope = (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
  // Falls back to a status the route already set on the reply, which
  // Fastify's default handler preserves and this would otherwise discard.
  //
  // The upper clamp guards this handler, not Node: `reply.code()` rejects
  // anything outside 100–599 with FST_ERR_BAD_STATUS_CODE, and `handleError`
  // wraps the call to this function in a try/catch whose `catch` does
  // `reply.send(err)`. So an unclamped 600 would throw here and be re-sent
  // through the root handler as Fastify's `{ statusCode, error, message }`
  // prose — the exact envelope this file exists to keep off the wire, leaking
  // on the one path least likely to be exercised.
  const fromReply = reply.statusCode >= 400 ? reply.statusCode : undefined
  const chosen = declaredStatus(error) ?? fromReply ?? 500
  const status = chosen <= 599 ? chosen : 500

  // 5xx is ours to explain, so it gets the stack. 4xx is the caller's
  // mistake and gets the facts without one: `info` is the default level, so
  // this branch is on in production, and `{ err }` would hand pino a full
  // stack per request — meaning anyone unauthenticated could fill the disk by
  // posting `{ not json` in a loop. The code, status and message are what
  // makes such a line useful anyway; the stack only says where Fastify's
  // parser lives.
  if (status >= 500) {
    request.log.error({ err: error }, 'request failed')
  } else {
    request.log.info({ code: error.code, status, reason: error.message }, 'request rejected')
  }

  // Fastify's default handler copies these across; replacing it drops them
  // silently. The two plausible sources are both on the roadmap — a 401
  // `WWW-Authenticate` challenge with #8, and `Retry-After` from the invite
  // rate limiter — and a missing challenge header looks like a client bug.
  const headers = headersFrom(error)
  if (headers !== undefined) void reply.headers(headers)

  const body: ErrorResponse = errorResponse(codeFor(status))
  return reply.code(status).send(body)
}

/**
 * The plainest thing that can still answer: a status and a constant body, no
 * derivation. If this throws too the connection drops, but there is nothing
 * left to fall back to.
 *
 * Takes plain `FastifyRequest`/`FastifyReply` rather than being written inline
 * for the same reason `sendEnvelope` does — the generics on the
 * `frameworkErrors` signature make `reply.code()` unassignable at the call
 * site.
 */
const sendLastResort = (request: FastifyRequest, reply: FastifyReply, failure: unknown) => {
  request.log.error({ err: failure }, 'framework error handler failed')
  void reply.code(500).send(errorResponse('internal_error'))
}

/** Everything thrown by a route, a hook, or the not-found handler. */
export const registerErrorHandler = (app: FastifyInstance) => {
  app.setErrorHandler<FastifyError>(sendEnvelope)
}

/**
 * Everything find-my-way rejects before a route is ever reached: a bad percent
 * escape (`/api/%zz`, FST_ERR_BAD_URL) and an over-long path parameter
 * (FST_ERR_MAX_PARAM_LENGTH, a 414).
 *
 * Pass as `frameworkErrors` when building the instance. Without it, `onBadUrl`
 * writes `{ error: 'Bad Request', code, message, statusCode }` straight to the
 * socket — prose in the field the envelope promises is a slug, on a URL any
 * caller can type, which `createApiClient` would hand back as
 * `code: 'Bad Request'`. `setErrorHandler` cannot cover it: the request never
 * reaches routing, so there is nothing to throw from.
 *
 * The two paths share the body but not Fastify's safety net, which is why this
 * has its own. `handleError` wraps the `setErrorHandler` call in a `catch` that
 * re-sends, so a throw there degrades to the prose envelope — ugly, but a
 * response. `onBadUrl` calls this bare and returns its value, so a throw
 * propagates out through find-my-way as an `uncaughtException` with nothing
 * written to the socket: a dropped connection and, under the container's
 * restart policy, a dead process. Verified, not assumed.
 *
 * Nothing reaches it today — `status` is clamped before `reply.code`, and none
 * of the framework errors carries `headers`, so `reply.headers` is never even
 * called here. It is containment for the version of this file that someone
 * edits later.
 */
export const frameworkErrorHandler: NonNullable<FastifyServerOptions['frameworkErrors']> = (
  error,
  request,
  reply,
) => {
  try {
    sendEnvelope(error, request, reply)
  } catch (failure) {
    sendLastResort(request, reply, failure)
  }
}
