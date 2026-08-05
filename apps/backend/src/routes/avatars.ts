import type { FastifyInstance } from 'fastify'

import { errorResponse } from '@sage-burner/shared'
import { eq } from 'drizzle-orm'

import type { GuardDeps } from '../auth/guards.ts'

import { createGuards } from '../auth/guards.ts'
import { viewerFor } from '../auth/viewer.ts'
import { accountAvatar } from '../db/schema.ts'
import { noStore } from '../http.ts'

export interface AvatarDeps extends GuardDeps {
  now?: () => Date
}

/**
 * What the upload route accepts, and what the CHECK allows.
 *
 * Three formats and no more: every browser this runs in can produce all three from a
 * canvas, so a longer list would only be more shapes to serve back.
 */
export const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

/**
 * The cap, enforced by Fastify before the body is read.
 *
 * The browser sizes the picture down to a couple of hundred pixels before sending, so
 * anything approaching this is either a client that did not or one that means harm.
 * Half a megabyte is generous for the former and cheap for the latter.
 */
export const MAX_AVATAR_BYTES = 512 * 1024

/**
 * Avatars — the picture in the circle, instead of initials.
 *
 * Stored in the database rather than on disk: the container has no writable path but
 * the data volume, and `docker compose up` has to stay sufficient.
 *
 * **Nothing here decodes an image.** There is no image library in this process and no
 * appetite for one, so the browser resizes before sending and the server takes the
 * bytes as given. The consequence is worth stating: the content type is what the
 * caller claims, and these bytes are served back with it. They are served to approved
 * members only, `Content-Disposition: inline` is never sent for an unknown type
 * because only three are storable, and `X-Content-Type-Options: nosniff` stops a
 * browser deciding for itself that a PNG is really HTML.
 */
export const registerAvatarRoutes = (
  app: FastifyInstance,
  { db, sessions, now = () => new Date() }: AvatarDeps,
) => {
  const { requireApproved } = createGuards({ db, sessions })

  // Raw bytes, for these three types only. It does not reopen the cross-site logout
  // hole `removeContentTypeParser('text/plain')` closed: a form can only send the
  // three form encodings, and none of them is an image type.
  app.addContentTypeParser(
    [...AVATAR_TYPES],
    { parseAs: 'buffer', bodyLimit: MAX_AVATAR_BYTES },
    (_request, body, done) => {
      done(null, body)
    },
  )

  app.put('/api/me/avatar', { preHandler: requireApproved }, async (request, reply) => {
    void noStore(reply)

    const type = AVATAR_TYPES.find((candidate) => candidate === request.headers['content-type'])
    if (type === undefined) return reply.code(415).send(errorResponse('bad_request'))

    if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
      return reply.code(400).send(errorResponse('bad_request'))
    }

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return reply.code(401).send(errorResponse('unauthenticated'))

    const updated_at = now().toISOString()

    await db
      .insert(accountAvatar)
      .values({ account_id: viewer.account_id, image: request.body, content_type: type, updated_at })
      .onConflictDoUpdate({
        target: accountAvatar.account_id,
        set: { image: request.body, content_type: type, updated_at },
      })

    // The version the circle's URL will carry, so a new picture is a new URL and no
    // cache has to be persuaded to let go of the old one.
    return { avatar: updated_at }
  })

  app.delete('/api/me/avatar', { preHandler: requireApproved }, async (request, reply) => {
    void noStore(reply)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return reply.code(401).send(errorResponse('unauthenticated'))

    await db.delete(accountAvatar).where(eq(accountAvatar.account_id, viewer.account_id))

    return reply.code(204).send()
  })

  /**
   * Somebody's picture.
   *
   * `requireApproved`, like the attendee list it is drawn beside: a face is no more
   * public than the name next to it, and both are already shown to every member.
   *
   * Cached, unlike everything else here, and it is safe *because* of the version in
   * the URL: `?v=` changes whenever the picture does, so a long max-age can never
   * show a stale one. `private` keeps it out of shared caches, since it is member
   * data — the same reason the rest of this app sends `no-store`.
   */
  app.get<{ Params: { accountId: string } }>(
    '/api/accounts/:accountId/avatar',
    { preHandler: requireApproved },
    async (request, reply) => {
      const [row] = await db
        .select()
        .from(accountAvatar)
        .where(eq(accountAvatar.account_id, request.params.accountId))
        .limit(1)

      if (row === undefined) {
        void noStore(reply)
        return reply.code(404).send(errorResponse('not_found'))
      }

      return (
        reply
          .header('content-type', row.content_type)
          // The bytes are whatever was uploaded and the type is what the uploader
          // claimed, so a browser must not be allowed to decide for itself that a PNG
          // is really something it should run.
          .header('x-content-type-options', 'nosniff')
          .header('cache-control', 'private, max-age=604800')
          .send(row.image)
      )
    },
  )
}
