import { z } from 'zod'

import { MAX_NOTES, MAX_TITLE } from '../limits.ts'
import { dateTimeSchema, idSchema, nonEmptyText } from './common.ts'

export const bringItemSchema = z.object({
  id: idSchema,
  event_id: idSchema,
  author_account_id: idSchema.nullable(),
  title: nonEmptyText(MAX_TITLE),
  comment: z.string().trim().max(MAX_NOTES),
  withdrawn_at: dateTimeSchema.nullable(),
  created_at: dateTimeSchema,
})
export type BringItem = z.infer<typeof bringItemSchema>

export const bringEntrySchema = bringItemSchema.extend({
  author_name: z.string().nullable(),
  hands: z.array(z.object({ account_id: idSchema, name: z.string().nullable() })),
  thread_id: idSchema.nullable(),
})
export type BringEntry = z.infer<typeof bringEntrySchema>

export const bringListResponseSchema = z.object({ items: z.array(bringEntrySchema) })
export type BringListResponse = z.infer<typeof bringListResponseSchema>

export const bringResponseSchema = z.object({ item: bringEntrySchema })
export type BringResponse = z.infer<typeof bringResponseSchema>

export const bringCreateSchema = bringItemSchema
  .omit({ id: true, event_id: true, author_account_id: true, withdrawn_at: true, created_at: true })
  .extend({ comment: bringItemSchema.shape.comment.default(''), bringing: z.boolean().default(false) })
  .strict()
export type BringCreate = z.infer<typeof bringCreateSchema>
export type BringCreateInput = z.input<typeof bringCreateSchema>

export const bringUpdateSchema = bringItemSchema.pick({ title: true, comment: true }).partial().strict()
export type BringUpdate = z.infer<typeof bringUpdateSchema>
