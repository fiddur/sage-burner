import type { FeedResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { apiRoutes } from '@sage-burner/shared'
import { desc, eq } from 'drizzle-orm'

import type { GuardDeps } from '../auth/guards.ts'

import { createGuards } from '../auth/guards.ts'
import { activity, event } from '../db/schema.ts'
import { noStore } from '../http.ts'
import { readThreads, recentThreads } from './threads.ts'

/** How much of it a page shows. An audit log is not what this is for. */
export const FEED_LIMIT = 50

/**
 * How many lines a card carries.
 *
 * The end of the conversation, with a count saying how much more there is — enough to
 * see what is being talked about without opening it. It is also what bounds the page:
 * fifty cards of three entries of `MAX_COMMENT`, which the installed app keeps on disk
 * as one cache entry, replaced in place. The whole thread is a read of its own, and that
 * one is deliberately never cached (#375).
 */
export const CARD_ENTRIES = 3

/**
 * `GET /api/feed` — what everyone has been doing (#303), and what they are talking
 * about (#375). `docs/the-app.md` has the why.
 *
 * **Across burns**, the one place this diverges from #184's rule that a burn-scoped route
 * takes an event id, so each line names its own burn instead.
 *
 * `requireApproved`, like the roster: everything here is already readable by an approved
 * member, gathered into one place. Nothing about payment, contact details or allergies
 * can be in it, because only the burn-wide notifications write to `activity` and only
 * members write the threads.
 *
 * **Reading it writes nothing.** The bell's unseen count is `notification`'s.
 */
export const registerFeedRoutes = (app: FastifyInstance, { db, sessions }: GuardDeps) => {
  const { requireApproved } = createGuards({ db, sessions })

  app.get(apiRoutes.getFeed.fastify, { preHandler: requireApproved }, async (_request, reply) => {
    void noStore(reply)

    const lines = await db
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

    const recent = await recentThreads(db, FEED_LIMIT)

    // Fifty *things*, not fifty of each. Both halves are read at the limit and then cut
    // against each other, so a burn full of talk cannot push its news off the page and
    // a quiet one does not leave the page half empty.
    const kept = new Set(
      [
        ...lines.map((line) => ({ id: line.id, at: line.created_at })),
        ...recent.map((one) => ({ id: one.id, at: one.last_at })),
      ]
        .sort((one, other) =>
          one.at === other.at ? other.id.localeCompare(one.id) : other.at.localeCompare(one.at),
        )
        .slice(0, FEED_LIMIT)
        .map((one) => one.id),
    )

    const threads = await readThreads(
      db,
      recent.filter((one) => kept.has(one.id)).map((one) => one.id),
      { newest: CARD_ENTRIES, counts: new Map(recent.map((one) => [one.id, one.entry_count])) },
    )

    return { activity: lines.filter((line) => kept.has(line.id)), threads } satisfies FeedResponse
  })
}
