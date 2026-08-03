import { z } from 'zod'

import { nonEmptyText } from './common.ts'

/**
 * What a browser hands over when it agrees to be notified.
 *
 * The shape `PushSubscription.toJSON()` produces, flattened: the endpoint is the
 * push service's URL for that browser, and the two keys are what the payload is
 * encrypted to. `.strict()` for the usual reason — a misspelt key here would
 * store a subscription that can never be delivered to, and say 201.
 *
 * The endpoint is a URL and bounded: it is chosen by the browser's push service,
 * not by us, and an unbounded string on a write is a row of any size.
 */
export const pushSubscriptionCreateSchema = z
  .object({
    endpoint: z.url().max(2000),
    p256dh: nonEmptyText(200),
    auth: nonEmptyText(200),
  })
  .strict()

export type PushSubscriptionCreate = z.infer<typeof pushSubscriptionCreateSchema>

/**
 * The public half of the installation's VAPID pair.
 *
 * Public by nature — a browser needs it to subscribe, and it identifies the
 * server to the push service. Null when push has not been set up.
 */
export const pushKeyResponseSchema = z.object({ public_key: z.string().nullable() })

export type PushKeyResponse = z.infer<typeof pushKeyResponseSchema>
