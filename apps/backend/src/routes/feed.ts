import type { FeedResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { apiRoutes } from '@sage-burner/shared'
import { desc, eq } from 'drizzle-orm'

import type { GuardDeps } from '../auth/guards.ts'

import { createGuards } from '../auth/guards.ts'
import { activity, event } from '../db/schema.ts'
import { noStore } from '../http.ts'

/** How much of it a page shows. An audit log is not what this is for. */
export const FEED_LIMIT = 50

/**
 * `GET /api/feed` — what everyone has been doing (#303). `docs/the-app.md` has the why.
 *
 * **Across burns**, the one place this diverges from #184's rule that a burn-scoped route
 * takes an event id, so each line names its own burn instead.
 *
 * `requireApproved`, like the roster: everything here is already readable by an approved
 * member, gathered into one place. Nothing about payment, contact details or allergies
 * can be in it, because only the burn-wide notifications write to `activity`.
 *
 * **Reading it writes nothing.** The bell's unseen count is `notification`'s.
 */
export const registerFeedRoutes = (app: FastifyInstance, { db, sessions }: GuardDeps) => {
  const { requireApproved } = createGuards({ db, sessions })

  app.get(apiRoutes.getFeed.fastify, { preHandler: requireApproved }, async (_request, reply) => {
    void noStore(reply)

    const rows = await db
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
      // The id breaks the tie: several rows can share a stamp — a copied register writes
      // a millisecond apart, but nothing promises that — and a feed whose order changes
      // between two reads of the same data reads as though something happened twice.
      .orderBy(desc(activity.created_at), desc(activity.id))
      .limit(FEED_LIMIT)

    return { activity: rows } satisfies FeedResponse
  })
}
