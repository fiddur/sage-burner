import { z } from 'zod'

import { idSchema } from './common.ts'

/**
 * Seeding one burn's list from a previous burn's.
 *
 * Two per-burn lists offer this — the lead-roles register and the schedule's
 * places — and a third will want it. One vocabulary rather than one per list,
 * because the alternative is the same two schemas written out again each time and
 * corrected in one place when they change.
 */
export const copyFromSchema = z.object({ from_event_id: idSchema }).strict()

/**
 * Which burns a list could be seeded from, and how much each holds.
 *
 * `count` rather than `roles` or `places`: the number means "how many you would
 * get", and naming it per list is what would make this two schemas. The wording a
 * page puts around it is the page's business.
 *
 * Its own response rather than the admin event list, which a member cannot read:
 * only burns that already hold something appear, and only their name. A burn's
 * dates and cap stay admin's.
 */
export const copySourcesResponseSchema = z.object({
  sources: z.array(z.object({ event_id: idSchema, name: z.string(), count: z.int() })),
})

export type CopyFrom = z.infer<typeof copyFromSchema>
export type CopySourcesResponse = z.infer<typeof copySourcesResponseSchema>
