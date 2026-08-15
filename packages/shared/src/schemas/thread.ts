import { z } from 'zod'

import { threadEntityTypes, threadEntryKinds } from '../enums.ts'
import { MAX_COMMENT, MAX_TITLE } from '../limits.ts'
import { dateTimeSchema, idSchema, nonEmptyText } from './common.ts'

export const supporterSchema = z.object({
  account_id: idSchema,
  name: z.string().nullable(),
  avatar: dateTimeSchema.nullable(),
})
export type Supporter = z.infer<typeof supporterSchema>

export const threadEntrySchema = z.object({
  id: idSchema,
  kind: z.enum(threadEntryKinds),
  author: z.object({ account_id: idSchema, name: z.string().nullable() }).nullable(),
  body: z.string(),
  created_at: dateTimeSchema,
  edited_at: dateTimeSchema.nullable(),
  supporters: z.array(supporterSchema),
  support_count: z.int().min(0),
  supported_by_me: z.boolean(),
})
export type ThreadEntry = z.infer<typeof threadEntrySchema>

export const threadSchema = z.object({
  id: idSchema,
  event_id: idSchema.nullable(),
  burn: z.string().max(MAX_TITLE).nullable(),
  entity_type: z.enum(threadEntityTypes),
  entity_id: idSchema,
  title: z.string().max(MAX_TITLE),
  link: z.string().nullable(),
  body: z.string().nullable(),
  own: z.boolean(),
  gone: z.boolean(),
  entry_count: z.int().min(0),
  last_at: dateTimeSchema.nullable(),
  entries: z.array(threadEntrySchema),
  supporters: z.array(supporterSchema),
  support_count: z.int().min(0),
  supported_by_me: z.boolean(),
  followed_by_me: z.boolean(),
})
export type Thread = z.infer<typeof threadSchema>

export const threadResponseSchema = z.object({ thread: threadSchema })
export type ThreadResponse = z.infer<typeof threadResponseSchema>

export const feedResponseSchema = z.object({ threads: z.array(threadSchema) })
export type FeedResponse = z.infer<typeof feedResponseSchema>

export const commentSchema = z.object({ body: nonEmptyText(MAX_COMMENT) }).strict()
export type CommentInput = z.infer<typeof commentSchema>

export const followSchema = z.object({ following: z.boolean() }).strict()
export type FollowInput = z.infer<typeof followSchema>
