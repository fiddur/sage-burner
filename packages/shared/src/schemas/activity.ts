import { z } from 'zod'

import { notificationCategories } from '../enums.ts'
import { MAX_TITLE } from '../limits.ts'
import { dateTimeSchema, idSchema } from './common.ts'
import { threadSchema } from './thread.ts'

/**
 * One thing that happened at a burn, as the feed shows it (#303).
 *
 * The wording is the server's — the same third-person sentence the notification carries,
 * so the two cannot describe one event differently. `burn` is the name and not only the
 * id because the page spans burns, and `category` is a notification category because the
 * chip beside the line switches one on.
 */
export const activitySchema = z.object({
  id: idSchema,
  event_id: idSchema,
  burn: z.string().max(MAX_TITLE),
  category: z.enum(notificationCategories),
  body: z.string(),
  /** A path in this app, like a notification's. Null for anything with no page. */
  link: z.string().nullable(),
  created_at: dateTimeSchema,
})
export type Activity = z.infer<typeof activitySchema>

/**
 * The feed: the burn's news, and the conversations (#375).
 *
 * Two arrays rather than one list of a union, because they are two things — a line is
 * something that happened and a card is somewhere people are talking. Both are newest
 * first, and the route has already merged them by time and cut the pair to its limit,
 * so a reader interleaves by timestamp and shows what it is given.
 *
 * Additive on purpose. Collapsing everything by thread would put the burn's own news —
 * somebody joined, a lead role taken — behind one card per burn, which is the feed's
 * list disappearing into an accordion. `activity` keeps what has no conversation, and
 * shrinks as each kind of thing gains one.
 */
export const feedResponseSchema = z.object({
  activity: z.array(activitySchema),
  threads: z.array(threadSchema),
})
export type FeedResponse = z.infer<typeof feedResponseSchema>
