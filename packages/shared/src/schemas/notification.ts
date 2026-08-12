import { z } from 'zod'

import { notificationCategories } from '../enums.ts'
import { dateTimeSchema, idSchema } from './common.ts'

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
  unseen: z.int().min(0),
})
export type NotificationsResponse = z.infer<typeof notificationsResponseSchema>

export const targetShownSchema = z
  .object({ link: z.string().min(1).max(2048), as_of: dateTimeSchema })
  .strict()
export type TargetShownInput = z.infer<typeof targetShownSchema>

export const notificationSettingsSchema = z
  .object({
    on: z.array(z.enum(notificationCategories)),
    email: z.array(z.enum(notificationCategories)),
  })
  .strict()
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>
