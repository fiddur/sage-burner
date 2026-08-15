import type { FeedResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { apiRoutes, feedKindsFrom, threadEntityTypes } from '@sage-burner/shared'

import type { GuardDeps } from '../auth/guards.ts'

import { createGuards } from '../auth/guards.ts'
import { viewerFor } from '../auth/viewer.ts'
import { noStore } from '../http.ts'
import { readThreads, recentThreads } from './threads.ts'

export const FEED_LIMIT = 50

export const CARD_ENTRIES = 3

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

      const recent = entities.length === 0 ? [] : await recentThreads(db, FEED_LIMIT, entities)

      const cards = await readThreads(
        db,
        recent.map((one) => one.id),
        { newest: CARD_ENTRIES, counts: new Map(recent.map((one) => [one.id, one.entry_count])), viewer },
      )

      return { threads: cards.filter((card) => !card.gone) } satisfies FeedResponse
    },
  )
}
