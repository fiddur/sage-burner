import type { SongCategoriesResponse, SongCategoryResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import {
  apiRoutes,
  idOrderSchema,
  songCategoryCreateSchema,
  songCategoryUpdateSchema,
} from '@sage-burner/shared'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'

import { createGuards } from '../auth/guards.ts'
import { nextOrder, reorder } from '../db/ordered.ts'
import { songCategory } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { categoriesFor } from './songs.ts'

export const registerSongCategoryRoutes = (app: FastifyInstance, { db, sessions }: GuardDeps) => {
  const { requireApproved } = createGuards({ db, sessions })

  const listed = async (): Promise<SongCategoriesResponse> => ({ categories: await categoriesFor(db) })

  app.get(apiRoutes.getSongCategories.fastify, { preHandler: requireApproved }, async (_request, reply) => {
    void noStore(reply)

    return await listed()
  })

  app.post(apiRoutes.addSongCategory.fastify, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(songCategoryCreateSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const id = randomUUID()

    const order = db.transaction((tx) => {
      const next = nextOrder(tx, songCategory)
      tx.insert(songCategory)
        .values({ ...body, id, order: next })
        .run()

      return next
    })

    return reply.code(201).send({ category: { ...body, id, order } } satisfies SongCategoryResponse)
  })

  app.patch<{ Params: { id: string } }>(apiRoutes.updateSongCategory.fastify, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(songCategoryUpdateSchema, request)
    if (body === undefined) return sendError(reply, 400)

    if (Object.keys(body).length === 0) {
      const [held] = await db
        .select()
        .from(songCategory)
        .where(eq(songCategory.id, request.params.id))
        .limit(1)

      return held === undefined ? sendError(reply, 404) : ({ category: held } satisfies SongCategoryResponse)
    }

    const [updated] = await db
      .update(songCategory)
      .set(body)
      .where(eq(songCategory.id, request.params.id))
      .returning()

    return updated === undefined
      ? sendError(reply, 404)
      : ({ category: updated } satisfies SongCategoryResponse)
  })

  app.delete<{ Params: { id: string } }>(apiRoutes.deleteSongCategory.fastify, async (request, reply) => {
    void noStore(reply)

    const [gone] = await db
      .delete(songCategory)
      .where(eq(songCategory.id, request.params.id))
      .returning({ id: songCategory.id })

    if (gone === undefined) return sendError(reply, 404)

    return reply.code(204).send()
  })

  app.put(apiRoutes.reorderSongCategories.fastify, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(idOrderSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const renumbered = reorder(db, songCategory, await categoriesFor(db), body.ids)
    if (renumbered === 'mismatch') return sendError(reply, 400)

    return await listed()
  })
}
