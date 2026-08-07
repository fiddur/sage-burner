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
 * `GET /api/feed` — what everyone has been doing (#303).
 *
 * **Across burns, not per burn**, which is the one place this diverges from #184's rule
 * that a burn-scoped route takes an event id: the quiet between burns is what the page
 * exists to fill, and "somebody joined the Autumn Burn" is news to people still
 * thinking about the summer one. Each line names its burn for the same reason.
 *
 * `requireApproved`, like the roster. Everything here is already readable by an approved
 * member — who is coming, who leads what, which dreams exist — and the feed gathers into
 * one place what is spread across pages. Nothing about payment, contact details or
 * allergies is in it, because nothing that reaches `activity` is: the rows are written
 * from the burn-wide notifications, which are the ones that go to everybody attending.
 *
 * **Reading it writes nothing.** The bell's unseen count is `notification`'s, and a feed
 * that marked itself read would be a second thing to keep in step with it.
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
