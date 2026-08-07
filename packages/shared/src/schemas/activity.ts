import { z } from 'zod'

import { notificationCategories } from '../enums.ts'
import { MAX_TITLE } from '../limits.ts'
import { dateTimeSchema, idSchema } from './common.ts'

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

/** Newest first, bounded by the route. */
export const feedResponseSchema = z.object({ activity: z.array(activitySchema) })
export type FeedResponse = z.infer<typeof feedResponseSchema>
