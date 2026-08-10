import { z } from 'zod'

import { MAX_POST, MAX_TITLE } from '../limits.ts'
import { dateTimeSchema, idSchema, nonEmptyText } from './common.ts'

export const postSchema = z.object({
  id: idSchema,
  event_id: idSchema,
  author_account_id: idSchema.nullable(),
  title: nonEmptyText(MAX_TITLE),
  body: z.string().max(MAX_POST),
  withdrawn_at: dateTimeSchema.nullable(),
  created_at: dateTimeSchema,
})
export type Post = z.infer<typeof postSchema>

export const postResponseSchema = z.object({ post: postSchema })
export type PostResponse = z.infer<typeof postResponseSchema>

export const postCreateSchema = postSchema
  .omit({
    id: true,
    event_id: true,
    author_account_id: true,
    withdrawn_at: true,
    created_at: true,
  })
  .strict()
export type PostCreate = z.infer<typeof postCreateSchema>

export const postUpdateSchema = postCreateSchema.partial().strict()
export type PostUpdate = z.infer<typeof postUpdateSchema>
