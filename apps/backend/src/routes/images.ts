import type { ImageUploadResponse, MyImagesResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { apiRoutes, isImageType, MAX_IMAGE_BYTES, MAX_IMAGES_PER_ACCOUNT } from '@sage-burner/shared'
import { and, count, desc, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'

import { createGuards } from '../auth/guards.ts'
import { viewerFor } from '../auth/viewer.ts'
import { image } from '../db/schema.ts'
import { noStore, sendError } from '../http.ts'

export interface ImageDeps extends GuardDeps {
  now: () => Date
}

/**
 * Pictures inside markdown (#379).
 *
 * **Nothing here decodes an image**, which is the rule the avatar, the icon and the
 * banner all state and the one worth keeping hardest here: this is the upload that takes
 * whatever a camera produced. The browser scales it on a canvas before sending, and the
 * server stores the bytes as given. So the content type is what the caller claims and
 * those bytes are served back with it — bounded by a short list of storable types,
 * `X-Content-Type-Options: nosniff`, and `requireApproved` on both ends.
 */
export const registerImageRoutes = (app: FastifyInstance, { db, sessions, now }: ImageDeps) => {
  const { requireApproved } = createGuards({ db, sessions })

  app.post(
    apiRoutes.uploadImage.fastify,
    { bodyLimit: MAX_IMAGE_BYTES, preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const content_type = request.headers['content-type']
      if (!isImageType(content_type)) return sendError(reply, 415)

      if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
        return sendError(reply, 400)
      }

      const viewer = await viewerFor(request, { db, sessions })
      if (viewer === undefined) return sendError(reply, 401)

      const [stored] = await db
        .select({ held: count() })
        .from(image)
        .where(eq(image.uploaded_by, viewer.account_id))

      if ((stored?.held ?? 0) >= MAX_IMAGES_PER_ACCOUNT) return sendError(reply, 409)

      // `randomUUID` is CSPRNG, so 122 bits stand between a URL and the next one. That
      // is defence in depth rather than the guard — `requireApproved` is — but it means
      // an id leaking out of somebody's prose exposes that picture and no other.
      const id = randomUUID()

      await db.insert(image).values({
        id,
        bytes: request.body,
        content_type,
        uploaded_by: viewer.account_id,
        created_at: now().toISOString(),
      })

      return reply.code(201).send({ id } satisfies ImageUploadResponse)
    },
  )

  /**
   * The picture itself.
   *
   * `requireApproved`, like the avatar, and what that costs the public-facing fields is
   * in `docs/the-app.md`.
   *
   * Cached hard, and safe because an image is immutable: this id will never answer with
   * different bytes, so no cache here can go stale. `private` keeps it out of shared
   * ones, since it is member data.
   */
  app.get<{ Params: { id: string } }>(
    apiRoutes.storedImage.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      const [row] = await db.select().from(image).where(eq(image.id, request.params.id)).limit(1)

      if (row === undefined) {
        void noStore(reply)
        return sendError(reply, 404)
      }

      return reply
        .header('content-type', row.content_type)
        .header('x-content-type-options', 'nosniff')
        .header('cache-control', 'private, max-age=31536000, immutable')
        .send(row.bytes)
    },
  )

  /**
   * What this account has stored, newest first (#392).
   *
   * Named columns rather than the row: `bytes` is up to two megabytes apiece and a list
   * of five hundred of them is not a JSON response anybody wants. The page draws each
   * one through `storedImage`.
   */
  app.get(apiRoutes.getMyImages.fastify, { preHandler: requireApproved }, async (request, reply) => {
    void noStore(reply)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return sendError(reply, 401)

    const rows = await db
      .select({ id: image.id, created_at: image.created_at })
      .from(image)
      .where(eq(image.uploaded_by, viewer.account_id))
      .orderBy(desc(image.created_at), desc(image.id))

    return { images: rows } satisfies MyImagesResponse
  })

  /**
   * Taking one back off (#392), which is what makes `MAX_IMAGES_PER_ACCOUNT` recoverable.
   *
   * The account is in the `WHERE`, so somebody else's id is a 404 rather than a write —
   * the same shape as a connection, and for the same reason.
   *
   * **A picture still referenced from prose is deleted anyway**, leaving that markdown
   * pointing at nothing. Refusing instead would mean knowing every markdown column in the
   * schema, which is the list `docs/the-app.md` explains why this app does not keep; the
   * page says plainly what a removal costs before anybody presses it.
   */
  app.delete<{ Params: { id: string } }>(
    apiRoutes.removeMyImage.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const viewer = await viewerFor(request, { db, sessions })
      if (viewer === undefined) return sendError(reply, 401)

      const removed = await db
        .delete(image)
        .where(and(eq(image.id, request.params.id), eq(image.uploaded_by, viewer.account_id)))
        .returning({ id: image.id })

      if (removed.length === 0) return sendError(reply, 404)

      return reply.code(204).send()
    },
  )
}
