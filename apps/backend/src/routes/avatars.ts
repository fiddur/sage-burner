import type { FastifyInstance } from 'fastify'

import { apiRoutes } from '@sage-burner/shared'
import { eq } from 'drizzle-orm'

import type { GuardDeps } from '../auth/guards.ts'

import { createGuards } from '../auth/guards.ts'
import { viewerFor } from '../auth/viewer.ts'
import { accountAvatar } from '../db/schema.ts'
import { noStore, sendError } from '../http.ts'

export interface AvatarDeps extends GuardDeps {
  now: () => Date
}

export const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

export const MAX_AVATAR_BYTES = 512 * 1024

export const registerAvatarRoutes = (app: FastifyInstance, { db, sessions, now }: AvatarDeps) => {
  const { requireApproved } = createGuards({ db, sessions })

  const upload = { bodyLimit: MAX_AVATAR_BYTES, preHandler: requireApproved }

  app.put(apiRoutes.setMyAvatar.fastify, upload, async (request, reply) => {
    void noStore(reply)

    const type = AVATAR_TYPES.find((candidate) => candidate === request.headers['content-type'])
    if (type === undefined) return sendError(reply, 415)

    if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
      return sendError(reply, 400)
    }

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return sendError(reply, 401)

    const updated_at = now().toISOString()

    await db
      .insert(accountAvatar)
      .values({ account_id: viewer.account_id, image: request.body, content_type: type, updated_at })
      .onConflictDoUpdate({
        target: accountAvatar.account_id,
        set: { image: request.body, content_type: type, updated_at },
      })

    return { avatar: updated_at }
  })

  app.delete(apiRoutes.removeMyAvatar.fastify, { preHandler: requireApproved }, async (request, reply) => {
    void noStore(reply)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return sendError(reply, 401)

    await db.delete(accountAvatar).where(eq(accountAvatar.account_id, viewer.account_id))

    return reply.code(204).send()
  })

  app.get<{ Params: { accountId: string } }>(
    apiRoutes.accountAvatar.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      const [row] = await db
        .select()
        .from(accountAvatar)
        .where(eq(accountAvatar.account_id, request.params.accountId))
        .limit(1)

      if (row === undefined) {
        void noStore(reply)
        return sendError(reply, 404)
      }

      return reply
        .header('content-type', row.content_type)
        .header('x-content-type-options', 'nosniff')
        .header('cache-control', 'private, max-age=604800')
        .send(row.image)
    },
  )
}
