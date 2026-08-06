import { z } from 'zod'

import { notificationCategories } from '../enums.ts'
import { dateTimeSchema, idSchema } from './common.ts'

/**
 * One thing that happened to somebody, as the bell shows it.
 *
 * `link` is a path in this app rather than a URL — the bell renders it as an
 * `href`, and anything that could be somewhere else would be an open redirect
 * dressed up as a notification.
 */
export const notificationSchema = z.object({
  id: idSchema,
  category: z.enum(notificationCategories),
  body: z.string(),
  link: z.string().nullable(),
  created_at: dateTimeSchema,
  seen_at: dateTimeSchema.nullable(),
})
export type Notification = z.infer<typeof notificationSchema>

export const notificationsResponseSchema = z.object({
  notifications: z.array(notificationSchema),
  /** What the red bubble counts. Derived here so two readers cannot disagree. */
  unseen: z.int().min(0),
})
export type NotificationsResponse = z.infer<typeof notificationsResponseSchema>

/**
 * Which categories are switched off. Absence is on, so an empty list is the default
 * and nothing has to be seeded for a new account.
 */
export const notificationSettingsSchema = z
  .object({ muted: z.array(z.enum(notificationCategories)) })
  .strict()
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>
