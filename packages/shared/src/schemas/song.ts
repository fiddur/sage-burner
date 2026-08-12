import { z } from 'zod'

import { isProfileUrl } from '../enums.ts'
import {
  MAX_CAPO,
  MAX_OPTION_LABEL,
  MAX_SONG_BODY,
  MAX_SONG_CATEGORIES,
  MAX_SONG_LINK_URL,
  MAX_SONG_LINKS,
  MAX_TITLE,
} from '../limits.ts'
import { dateTimeSchema, idOrderSchema, idSchema, nonEmptyText } from './common.ts'
import { threadSchema } from './thread.ts'

export const songLinkSchema = z
  .object({
    url: nonEmptyText(MAX_SONG_LINK_URL).refine((url) => isProfileUrl(url), {
      error: 'a link must be an https:// address',
    }),
  })
  .strict()
export type SongLink = z.infer<typeof songLinkSchema>

export const songSchema = z.object({
  id: idSchema,
  title: nonEmptyText(MAX_TITLE),
  artist: nonEmptyText(MAX_TITLE).nullable(),
  body: z.string().max(MAX_SONG_BODY),
  capo: z.int().min(0).max(MAX_CAPO).nullable(),
  links: z.array(songLinkSchema).max(MAX_SONG_LINKS),
  category_ids: z.array(idSchema).max(MAX_SONG_CATEGORIES),
  author_account_id: idSchema.nullable(),
  deleted_at: dateTimeSchema.nullable(),
  created_at: dateTimeSchema,
})
export type Song = z.infer<typeof songSchema>

export const songSummarySchema = songSchema.omit({ body: true })
export type SongSummary = z.infer<typeof songSummarySchema>

export const songResponseSchema = z.object({ song: songSchema, thread: threadSchema.nullable() })
export type SongResponse = z.infer<typeof songResponseSchema>

export const songCategorySchema = z.object({
  id: idSchema,
  order: z.int().nonnegative(),
  label: nonEmptyText(MAX_OPTION_LABEL),
})
export type SongCategory = z.infer<typeof songCategorySchema>

export const songbookResponseSchema = z.object({
  songs: z.array(songSummarySchema),
  categories: z.array(songCategorySchema),
})
export type SongbookResponse = z.infer<typeof songbookResponseSchema>

export const songCreateSchema = z
  .object({
    title: songSchema.shape.title,
    artist: songSchema.shape.artist.default(null),
    body: songSchema.shape.body.default(''),
    capo: songSchema.shape.capo.default(null),
    links: songSchema.shape.links.default([]),
    category_ids: songSchema.shape.category_ids.default([]),
  })
  .strict()
export type SongCreate = z.infer<typeof songCreateSchema>
export type SongCreateInput = z.input<typeof songCreateSchema>

export const songUpdateSchema = songSchema
  .omit({ id: true, author_account_id: true, deleted_at: true, created_at: true })
  .partial()
  .strict()
export type SongUpdate = z.infer<typeof songUpdateSchema>

export const songCategoriesResponseSchema = z.object({ categories: z.array(songCategorySchema) })
export type SongCategoriesResponse = z.infer<typeof songCategoriesResponseSchema>

export const songCategoryResponseSchema = z.object({ category: songCategorySchema })
export type SongCategoryResponse = z.infer<typeof songCategoryResponseSchema>

export const songCategoryCreateSchema = songCategorySchema.omit({ id: true, order: true }).strict()
export type SongCategoryCreate = z.infer<typeof songCategoryCreateSchema>
export type SongCategoryCreateInput = z.input<typeof songCategoryCreateSchema>

export const songCategoryUpdateSchema = songCategoryCreateSchema.partial().strict()
export type SongCategoryUpdate = z.infer<typeof songCategoryUpdateSchema>

export const songCategoryOrderSchema = idOrderSchema
export type SongCategoryOrder = z.infer<typeof songCategoryOrderSchema>
