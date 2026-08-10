import { z } from 'zod'

import { notificationCategories } from '../enums.ts'
import { MAX_TITLE } from '../limits.ts'
import { dateTimeSchema, idSchema } from './common.ts'
import { threadSchema } from './thread.ts'

export const activitySchema = z.object({
  id: idSchema,
  event_id: idSchema,
  burn: z.string().max(MAX_TITLE),
  category: z.enum(notificationCategories),
  body: z.string(),
  link: z.string().nullable(),
  created_at: dateTimeSchema,
})
export type Activity = z.infer<typeof activitySchema>

export const feedResponseSchema = z.object({
  activity: z.array(activitySchema),
  threads: z.array(threadSchema),
})
export type FeedResponse = z.infer<typeof feedResponseSchema>
