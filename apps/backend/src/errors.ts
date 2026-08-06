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

/**
 * The `code` and `message` of the thrown thing, if it has them.
 *
 * `throw null` is legal and reaches here whenever the route already set a 4xx
 * on the reply — reading `error.code` off it threw, and Fastify's `catch`
 * re-sent that as its prose envelope with the original status lost. So the one
 * throw this handler could not handle produced exactly the output it exists to
 * prevent. Narrowed like `headersFrom` and `declaredStatus`, so "whatever was
 * thrown" is literally true.
 */
const detailsOf = (error: unknown): { code?: string; reason?: string } => {
  if (typeof error !== 'object' || error === null) {
    return typeof error === 'string' ? { reason: error } : {}
  }

  const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined
  const reason = 'message' in error && typeof error.message === 'string' ? error.message : undefined

  return { code, reason }
}

/**
 * The slug that goes with a status, and the only place the pairing is decided.
 *
 * Exported for `sendError` in `http.ts`, which is what the routes call. Before
 * that, every route spelled the pair out at the call site — 35 of them — so
 * nothing stopped a `404` being sent with `conflict` beside it (#138).
 */
export const codeFor = (status: number): ErrorCode => {
  if (status === 401) return 'unauthenticated'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 409) return 'conflict'
  // Its own slug rather than falling into `bad_request` below, which is the reason
  // `rate_limited` exists: a shed request is worth retrying and a malformed one is
  // not, and the status alone does not tell a caller which.
  if (status === 429) return 'rate_limited'
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
 *
 * Documented rather than enforced, which is the weak form for a failure this
 * quiet. #51 tracks the `onRoute` hook that would make it a boot failure
 * instead, the way `assertServableWebRoot` does for a bad WEB_ROOT.
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

  // Fastify's default handler copies these across; replacing it drops them
  // silently. The two plausible sources are both on the roadmap — a 401
  // `WWW-Authenticate` challenge with #8, and `Retry-After` from the invite
  // rate limiter — and a missing challenge header looks like a client bug.
  const headers = headersFrom(error)

  // 5xx is ours to explain, so it gets the stack. 4xx is the caller's
  // mistake and gets the facts without one: `info` is the default level, so
  // this branch is on in production, and `{ err }` would hand pino a full
  // stack per request — meaning anyone unauthenticated could fill the disk by
  // posting `{ not json` in a loop. The code, status and message are what
  // makes such a line useful anyway; the stack only says where Fastify's
  // parser lives.
  //
  // Names, never values: `loggerOptions` strips `err.headers` wholesale
  // because pino cannot redact by name across casings, so this is what is left
  // of them — and "a challenge was attached" is the readable part anyway.
  // A value here would be the session cookie.
  if (status >= 500) {
    request.log.error({ err: error, sent_headers: headers && Object.keys(headers) }, 'request failed')
  } else {
    request.log.info({ ...detailsOf(error), status }, 'request rejected')
  }

  if (headers !== undefined) void reply.headers(headers)

  const body: ErrorResponse = errorResponse(codeFor(status))
  return reply.code(status).send(body)
}

/**
 * The third path, and the one with no `reply` to send through: a malformed or
 * oversized request that Node's HTTP parser rejects before Fastify sees a
 * request at all.
 *
 * Pass as `clientErrorHandler` when building the instance. The default writes
 * `{"error":"Request Header Fields Too Large","message":…,"statusCode":431}`
 * directly to the socket — prose in the field the envelope promises is a slug,
 * which `createApiClient` would surface as
 * `code: 'Request Header Fields Too Large'`. A cookie-session app can reach
 * this without malice: enough accumulated cookies on the domain overflow the
 * header buffer.
 *
 * Mirrors the default's socket handling exactly, because there is no framework
 * left to do it — bail on a reset or destroyed socket, write only if writable,
 * destroy after. Nothing is logged: the default logs at `trace`, i.e. off, and
 * `this` is not typed on this callback.
 */
export const clientErrorHandler = (error: ConnectionError, socket: Socket) => {
  // Both cases mean nobody is listening; the default returns here too.
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
  // Response first, log second, and the log in its own catch. The failure this
  // exists to survive is most plausibly a log destination that has gone away —
  // in which case logging first would throw here too, and the caller would get
  // the dropped connection this was written to prevent. A lost log line is the
  // cheaper half.
  void reply.code(500).send(errorResponse('internal_error'))

  try {
    request.log.error({ err: failure }, 'framework error handler failed')
  } catch {
    // Nothing left to report it to.
  }
}

/**
 * `sendEnvelope`, with the fallback around it.
 *
 * Both handlers use this rather than `sendEnvelope` directly. The framework
 * path needs it because a throw there is an uncaughtException and a dropped
 * connection. The thrown path needs it for a different reason: `handleError`
 * catches and re-sends, so a throw degrades to Fastify's
 * `{ statusCode, error, message }` — a response, but the one response this file
 * exists to keep off the wire. And it is the path with the traffic. A log
 * destination that has gone away hits `sendEnvelope` on every rejected request,
 * not only on a bad URL.
 */
const sendEnvelopeGuarded = (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
  try {
    sendEnvelope(error, request, reply)
  } catch (failure) {
    sendLastResort(request, reply, failure)
  }
}

/** Everything thrown by a route, a hook, or the not-found handler. */
export const registerErrorHandler = (app: FastifyInstance) => {
  app.setErrorHandler<FastifyError>(sendEnvelopeGuarded)
}

/**
 * Everything find-my-way rejects before a route is ever reached: a bad percent
 * escape (`/api/%zz`, FST_ERR_BAD_URL), an over-long path parameter
 * (FST_ERR_MAX_PARAM_LENGTH, a 414), and an async constraint strategy that
 * fails to resolve (FST_ERR_ASYNC_CONSTRAINT, a 500). The third has no test:
 * nothing in the tree registers a constraint strategy, and one would have to
 * exist purely to fail. It is also the site where the containment below matters
 * most — that call is inside an async callback, so a throw escapes even further
 * than on the other two.
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
export const frameworkErrorHandler: NonNullable<FastifyServerOptions['frameworkErrors']> = sendEnvelopeGuarded
