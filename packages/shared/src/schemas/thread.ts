import { z } from 'zod'

import { threadEntityTypes, threadEntryKinds } from '../enums.ts'
import { MAX_COMMENT, MAX_TITLE } from '../limits.ts'
import { dateTimeSchema, idSchema, nonEmptyText } from './common.ts'

/**
 * One line on a thread — what somebody said, or what the app did (#375).
 *
 * **The body carries no name and no title.** The thread says what it is about and the
 * author says who, both resolved when it is read, so neither can go stale the way a
 * feed line's frozen sentence does: `activity` says "offered a dream: Fire Circle" and
 * cannot be told that the dream is called something else now. A body is a verb phrase
 * that reads with "Somebody" in front of it, because an erased account leaves one.
 */
export const threadEntrySchema = z.object({
  id: idSchema,
  kind: z.enum(threadEntryKinds),
  /** Whoever did it or wrote it. Null only for a line nobody is behind. */
  author: z.object({ account_id: idSchema, name: z.string().nullable() }).nullable(),
  body: z.string(),
  created_at: dateTimeSchema,
  /** When it was last rewritten. What the whole card shows as "edited". */
  edited_at: dateTimeSchema.nullable(),
})
export type ThreadEntry = z.infer<typeof threadEntrySchema>

/**
 * A conversation about one thing, with as much of it as the reader asked for.
 *
 * One shape for both reads: the feed fills `entries` with the newest few and the count
 * says how many there are, while `GET /api/threads/:id` fills it with the lot. A second
 * shape for the card would be a second thing to keep in step with this one.
 *
 * `title` is the thread's own rather than the dream's, so a withdrawn dream still has
 * one — and `gone` is what says it was withdrawn, derived from the row being absent
 * rather than stored, so it cannot disagree with the dreams page.
 */
export const threadSchema = z.object({
  id: idSchema,
  event_id: idSchema,
  /** The burn's name: the feed spans burns, exactly as its lines do. */
  burn: z.string().max(MAX_TITLE),
  entity_type: z.enum(threadEntityTypes),
  entity_id: idSchema,
  title: z.string().max(MAX_TITLE),
  /** The thing it is about is no longer there. The conversation still is. */
  gone: z.boolean(),
  entry_count: z.int().min(0),
  /** When the newest entry landed — what the feed sorts on, so a card rises as it is used. */
  last_at: dateTimeSchema,
  /** Oldest first, the order a conversation is read in. */
  entries: z.array(threadEntrySchema),
})
export type Thread = z.infer<typeof threadSchema>

export const threadResponseSchema = z.object({ thread: threadSchema })
export type ThreadResponse = z.infer<typeof threadResponseSchema>

/** Saying something, and rewriting what you said. One shape, because they are one. */
export const commentSchema = z.object({ body: nonEmptyText(MAX_COMMENT) }).strict()
export type CommentInput = z.infer<typeof commentSchema>
