import type { FastifyInstance } from 'fastify'

import { BANNER_TYPE, ICON_TYPES, IMAGE_TYPES } from '@sage-burner/shared'

import { AVATAR_TYPES } from './avatars.ts'

/**
 * Every image type any route here takes, once.
 *
 * One registration rather than one per route, because Fastify throws on a second
 * parser for a type already claimed — and an avatar and the app icon are both
 * `image/png`. Deduplicated for that reason, not for tidiness.
 *
 * The banner's `image/jpeg` is already among the avatar's three, and is named anyway:
 * that overlap is a coincidence, and a day when avatars stop taking JPEG should not be
 * the day banner uploads start answering 415. `IMAGE_TYPES` is the same three as the
 * avatar's today, for the same reason and with the same independence.
 */
export const IMAGE_BODY_TYPES = [
  ...new Set<string>([...AVATAR_TYPES, ...ICON_TYPES, ...IMAGE_TYPES, BANNER_TYPE]),
]

/**
 * Raw bytes, for the routes that take an image.
 *
 * **No `bodyLimit` here, deliberately.** A parser's own limit takes precedence over
 * the route's, so a number written here would silently govern both routes and make
 * each one's cap unreachable — an icon's and an avatar's are equal today, which is a
 * coincidence rather than a reason. Each route states its own.
 *
 * It does not reopen the cross-site logout hole `removeContentTypeParser('text/plain')`
 * closed: a form can only send the three form encodings, and none of them is an image
 * type. `routes/auth.test.ts` asserts that directly.
 */
export const registerImageBodyParser = (app: FastifyInstance) => {
  app.addContentTypeParser(IMAGE_BODY_TYPES, { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body)
  })
}
