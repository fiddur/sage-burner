import { z } from 'zod'

import { notificationCategories } from '../enums.ts'
import { MAX_TITLE } from '../limits.ts'
import { dateTimeSchema, idSchema } from './common.ts'

/**
 * One thing that happened at a burn, as the feed shows it (#303).
 *
 * The wording is the server's — the same third-person sentence the burn-wide
 * notification carries, so the feed and the bell cannot describe one event two ways.
 *
 * `burn` is the name rather than only the id, because the feed spans burns: between
 * them the app is quiet, and "somebody joined the Autumn Burn" is news to people still
 * thinking about the summer one.
 *
 * `category` is a notification category, so the chip beside the line can offer to
 * switch that category on — which is the point of the chip, and why nothing can reach
 * the feed that a member could not have been notified about.
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

/** Newest first, bounded by the route. */
export const feedResponseSchema = z.object({ activity: z.array(activitySchema) })
export type FeedResponse = z.infer<typeof feedResponseSchema>
