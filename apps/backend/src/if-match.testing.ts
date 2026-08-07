import type { LightMyRequestResponse } from 'fastify'

/**
 * Sending a guarded write from a test that is not about the precondition (#274).
 *
 * A route behind `refuseIfStale` refuses a write carrying no `If-Match`, which is
 * most of the suite — a hundred-odd tests about renaming a lane or moving a sitting
 * would each have to fetch a version tag first, and would then be half about
 * concurrency and half about what they came to check.
 *
 * So the write helpers in the route suites go through this: send once, and if the
 * answer is the 428 asking for a precondition, take the tag off it and send again.
 * That is only possible because both refusals carry the current version in an `ETag`
 * — the same property the web client uses to make a retry after a conflict work
 * without a second read.
 *
 * **It hides the precondition, deliberately, and only from the tests that are not
 * about it.** Every guarded route has its own tests for the stale and missing cases,
 * written against `server.inject` directly, and those are what pin the contract.
 *
 * Lives outside the route suites rather than being copied into each: six copies of a
 * retry rule is six places for one of them to go stale.
 */
export const sendGuarded = async (
  send: (extraHeaders: Record<string, string>) => Promise<LightMyRequestResponse>,
): Promise<LightMyRequestResponse> => {
  const asked = await send({})
  if (asked.statusCode !== 428) return asked

  const version = asked.headers.etag

  return typeof version === 'string' ? send({ 'if-match': version }) : asked
}
