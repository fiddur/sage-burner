import { z } from 'zod'

import { idSchema } from './common.ts'

export const copyFromSchema = z.object({ from_event_id: idSchema }).strict()

export const copySourcesResponseSchema = z.object({
  sources: z.array(z.object({ event_id: idSchema, name: z.string(), count: z.int() })),
})

export type CopyFrom = z.infer<typeof copyFromSchema>
export type CopySourcesResponse = z.infer<typeof copySourcesResponseSchema>
