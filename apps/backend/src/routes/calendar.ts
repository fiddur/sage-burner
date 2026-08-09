import type { CalendarFeedResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { apiRoutes } from '@sage-burner/shared'
import { eq } from 'drizzle-orm'
import { randomBytes } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'

import { createGuards } from '../auth/guards.ts'
import { event } from '../db/schema.ts'
import { noStore, sendError } from '../http.ts'

/**
 * A new address for a burn's calendar feed.
 *
 * 32 CSPRNG bytes, like an invite token and like an OAuth state: the URL is the only thing
 * protecting the feed, so the whole of its strength is here.
 */
export const newFeedToken = (): string => randomBytes(32).toString('base64url')

/**
 * What a burn's feed is reachable at, and giving it a new one (#408).
 *
 * **Not a field on the burn.** `eventSchema` is the shape `/api/events/active` answers the
 * public homepage with, and putting the token there would undo the reason it exists — which
 * is exactly how the id ended up being no protection at all.
 *
 * Reading it is `requireApproved`: it is the link the Schedule page offers, and the schedule
 * itself is a member's to read. Rotating it is admin's, and lives under `/api/admin/` where
 * the prefix hook is the only authorization.
 *
 * A burn that has none — one written before the migration by something that skipped it — is
 * given one on read rather than answered with nothing. The column is nullable only because
 * adding it needed no table rebuild, so a null is a gap to close rather than a state to
 * report.
 */
export const registerCalendarRoutes = (app: FastifyInstance, { db, sessions }: GuardDeps) => {
  const { requireApproved } = createGuards({ db, sessions })

  const tokenFor = async (db_: Database, eventId: string): Promise<string | undefined> => {
    const [found] = await db_
      .select({ feed_token: event.feed_token })
      .from(event)
      .where(eq(event.id, eventId))
      .limit(1)

    if (found === undefined) return undefined
    if (found.feed_token !== null) return found.feed_token

    const minted = newFeedToken()
    await db_.update(event).set({ feed_token: minted }).where(eq(event.id, eventId))

    return minted
  }

  app.get<{ Params: { eventId: string } }>(
    apiRoutes.getCalendarToken.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const token = await tokenFor(db, request.params.eventId)
      if (token === undefined) return sendError(reply, 404)

      return { token } satisfies CalendarFeedResponse
    },
  )

  app.post<{ Params: { id: string } }>(apiRoutes.rotateCalendarToken.fastify, async (request, reply) => {
    void noStore(reply)

    const token = newFeedToken()
    const rotated = await db
      .update(event)
      .set({ feed_token: token })
      .where(eq(event.id, request.params.id))
      .returning({ id: event.id })

    if (rotated.length === 0) return sendError(reply, 404)

    // Every calendar already subscribed to the old address stops updating, silently — a
    // calendar client has nowhere to be told. That is what rotating is *for*, and the page
    // says so before the button is pressed.
    return { token } satisfies CalendarFeedResponse
  })
}
