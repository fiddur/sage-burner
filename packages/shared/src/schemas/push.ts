import { z } from 'zod'

import { nonEmptyText } from './common.ts'

export const pushSubscriptionCreateSchema = z
  .object({
    endpoint: z
      .url()
      .max(2000)
      .refine((value) => value.startsWith('https://'), { message: 'must be an https endpoint' }),
    p256dh: nonEmptyText(200),
    auth: nonEmptyText(200),
  })
  .strict()

export type PushSubscriptionCreate = z.infer<typeof pushSubscriptionCreateSchema>

export const pushKeyResponseSchema = z.object({ public_key: z.string().nullable() })

export type PushKeyResponse = z.infer<typeof pushKeyResponseSchema>
