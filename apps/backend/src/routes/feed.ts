import type { FeedResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { apiRoutes, feedKindsFrom, threadEntityTypes } from '@sage-burner/shared'
import { desc, eq } from 'drizzle-orm'

import type { GuardDeps } from '../auth/guards.ts'

import { createGuards } from '../auth/guards.ts'
import { viewerFor } from '../auth/viewer.ts'
import { activity, event } from '../db/schema.ts'
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
      const everything = asked.length === 0
      const entities = threadEntityTypes.filter((type) => everything || asked.includes(type))

      const lines =
        everything || asked.includes('activity')
          ? await db
              .select({
                id: activity.id,
                event_id: activity.event_id,
                burn: event.name,
                category: activity.category,
                body: activity.body,
                link: activity.link,
                created_at: activity.created_at,
              })
              .from(activity)
              .innerJoin(event, eq(event.id, activity.event_id))
              .orderBy(desc(activity.created_at), desc(activity.id))
              .limit(FEED_LIMIT)
          : []

      const recent = entities.length === 0 ? [] : await recentThreads(db, FEED_LIMIT, entities)

      const cards = await readThreads(
        db,
        recent.map((one) => one.id),
        { newest: CARD_ENTRIES, counts: new Map(recent.map((one) => [one.id, one.entry_count])), viewer },
      )

      const live = new Set(cards.flatMap((card) => (card.gone ? [] : [card.id])))

      const kept = new Set(
        [
          ...lines.map((line) => ({ id: line.id, at: line.created_at })),
          ...recent.filter((one) => live.has(one.id)).map((one) => ({ id: one.id, at: one.last_at })),
        ]
          .sort((one, other) =>
            one.at === other.at ? other.id.localeCompare(one.id) : other.at.localeCompare(one.at),
          )
          .slice(0, FEED_LIMIT)
          .map((one) => one.id),
      )

      return {
        activity: lines.filter((line) => kept.has(line.id)),
        threads: cards.filter((card) => kept.has(card.id)),
      } satisfies FeedResponse
    },
  )
}
