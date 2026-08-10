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
