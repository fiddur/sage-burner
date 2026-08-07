import type { FastifyReply, FastifyRequest } from 'fastify'

import { createHash } from 'node:crypto'

/**
 * Refusing a write whose author was looking at an older version of the thing (#274).
 *
 * This app deliberately does not engineer for races — 42 members, four burns a year —
 * and one case broke that rule for a reason. #256 made staleness a *designed*
 * property: what is on screen may be five minutes old, and offline arbitrarily older.
 * A lost update stopped being a same-millisecond coincidence and became an ordinary
 * outcome, so the burn's shared furniture is written under a precondition. Everything
 * else — somebody's own record, an admin workflow, taking or leaving a job — is
 * untouched, because there is no other author to lose to.
 *
 * The version is **computed from the representation**, not stored. There is no column
 * to migrate, nothing for a write to remember to bump, and reordering a whole
 * collection is covered by the same tag as editing one row in it. The cost is a read
 * per guarded write, which at this size is a query against a few dozen rows.
 */

/**
 * A strong `ETag` over what a `GET` answers.
 *
 * `JSON.stringify` of the very object that will be sent, so the tag cannot describe
 * something other than what the caller saw. That is also the one thing to get wrong
 * here: a guard computing its own shape rather than reusing the `GET`'s would refuse
 * every write forever, so each family has one function that both go through.
 */
export const versionOf = (payload: unknown): string =>
  `"${createHash('sha256').update(JSON.stringify(payload)).digest('base64url')}"`

/** Send a representation with the tag a later write has to quote back. */
export const withVersion = <T>(reply: FastifyReply, payload: T): T => {
  void reply.header('etag', versionOf(payload))

  return payload
}

/**
 * The precondition, answered rather than thrown.
 *
 * `If-Match` is **required** on a guarded write rather than honoured when present.
 * A missing header is the failure this exists to prevent — a caller that never read
 * the thing it is overwriting — and the alternative is that forgetting to send one
 * silently restores the old behaviour on that route alone. That is exactly the kind
 * of gap nobody notices until somebody's welcome text is gone.
 *
 * **Both refusals carry the current representation, and its tag**, which is what lets
 * the page say what the other person wrote instead of only that somebody did — and
 * lets the retry succeed without a second round trip. It is the same body the `GET`
 * would answer with, so it can only reach somebody already allowed to read it: every
 * guarded write is behind a guard at least as strict as its read. The tag is over the
 * representation, not over the envelope carrying it, so it is the one the next attempt
 * quotes back.
 *
 * Answers `true` when it has refused, so a handler reads
 * `if (await refuseIfStale(...)) return reply`.
 *
 * **A boolean rather than the reply itself**, which is what this was first and which
 * silently did nothing: `FastifyReply` is thenable — that is what makes `await reply`
 * work — so awaiting a promise that resolves to one chains onto its `then` and yields
 * `undefined`. The caller's `if (stale !== undefined)` was therefore never taken, the
 * write went ahead, and the 428 was sent alongside it. `return sendError(reply, 400)`
 * elsewhere is unaffected because nothing awaits the value on the way past.
 */
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
