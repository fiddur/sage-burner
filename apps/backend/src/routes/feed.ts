import type { FeedFold, FeedResponse, ThreadEntityType } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { apiRoutes, feedKindsFrom, FOLD_AT, foldRuns, threadEntityTypes } from '@sage-burner/shared'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'

import { createGuards } from '../auth/guards.ts'
import { viewerFor } from '../auth/viewer.ts'
import { noStore } from '../http.ts'
import { readThreads, recentThreads } from './threads.ts'

export const FEED_LIMIT = 50

export const FEED_WINDOW = FEED_LIMIT * 10

export const CARD_ENTRIES = 3

type Recent = Awaited<ReturnType<typeof recentThreads>>[number]

export const recentFeed = async (
  db: Database,
  entities: readonly ThreadEntityType[],
): Promise<{ rows: Recent[]; folds: FeedFold[] }> => {
  const recent = await recentThreads(db, FEED_WINDOW, entities)
  const byId = new Map(recent.map((row) => [row.id, row]))
  const items = foldRuns(recent).slice(0, FEED_LIMIT)

  return {
    rows: items
      .flatMap((item) => ('fold' in item ? item.fold.thread_ids : [item.id]))
      .flatMap((id) => byId.get(id) ?? []),
    folds: items.flatMap((item) => ('fold' in item ? [item.fold] : [])),
  }
}

export const withoutGone = (folds: readonly FeedFold[], present: ReadonlySet<string>): FeedFold[] =>
  folds
    .map((fold) => ({ ...fold, thread_ids: fold.thread_ids.filter((id) => present.has(id)) }))
    .filter((fold) => fold.thread_ids.length >= FOLD_AT)

export const registerFeedRoutes = (app: FastifyInstance, { db, sessions }: GuardDeps) => {
  const { requireApproved } = createGuards({ db, sessions })

  app.get<{ Querystring: { kinds?: string } }>(
    apiRoutes.getFeed.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const viewer = await viewerFor(request, { db, sessions })

      const asked = feedKindsFrom(request.query.kinds)
      const entities = threadEntityTypes.filter((type) => asked.length === 0 || asked.includes(type))

      const { rows, folds } = await recentFeed(db, entities)

      const cards = await readThreads(
        db,
        rows.map((one) => one.id),
        { newest: CARD_ENTRIES, counts: new Map(rows.map((one) => [one.id, one.entry_count])), viewer },
      )

      const threads = cards.filter((card) => !card.gone)

      return {
        threads,
        folds: withoutGone(folds, new Set(threads.map((card) => card.id))),
      } satisfies FeedResponse
    },
  )
}
