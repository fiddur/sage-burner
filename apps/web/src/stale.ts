import { isApiError } from './api/client.ts'

/**
 * Reading a refused write (#274).
 *
 * The server answers a write made against a version that has moved on with the
 * resource as it now stands, so these two turn that into the page's question:
 * did somebody get there first, and what did they put.
 */

/**
 * Whether a failure is the precondition being refused.
 *
 * Both statuses, because they are one situation to whoever is reading: 412 is a
 * version that has moved on, 428 is not having one at all — a tab that was open
 * across a sign-out, or a write the client sent before its read landed. Neither is
 * anybody's mistake and both are fixed by looking at what is there now.
 */
export const isStale = (failure: unknown): boolean =>
  isApiError(failure) && (failure.status === 412 || failure.status === 428)

/**
 * A string out of the refusal's payload, by the path the page knows it lives at.
 *
 * Narrowed step by step rather than cast: the payload is a different shape per
 * route and is the server's word for what it is, so the only honest reading is to
 * check each step. Answers nothing for a failure that is not a refusal, which is
 * what the caller wants — there is no other version to show.
 */
export const theirVersion = (failure: unknown, path: readonly string[]): string | undefined => {
  if (!isStale(failure) || !isApiError(failure)) return undefined

  let found: unknown = failure.payload
  for (const step of path) {
    if (typeof found !== 'object' || found === null || !(step in found)) return undefined

    found = Reflect.get(found, step)
  }

  return typeof found === 'string' ? found : undefined
}
