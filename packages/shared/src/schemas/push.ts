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
 * **`https` only, and bounded.** This is the one field in the app whose stored
 * value the server itself then requests, on every application — so an endpoint of
 * `http://10.0.0.5/…` would make the container POST to something on its own
 * network, chosen by whoever wrote the row. Only admins can write it and a real
 * push service is always `https`, so requiring the scheme costs nothing and takes
 * away the plain-HTTP path to the inside of the network. The remaining reach is a
 * `https` host, which is what a push service is; narrowing further would mean an
 * allowlist of every browser vendor's endpoint, which goes stale as a new one
 * appears.
 */
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

/**
 * The public half of the installation's VAPID pair.
 *
 * Public by nature — a browser needs it to subscribe, and it identifies the
 * server to the push service. Null when push has not been set up.
 */
export const pushKeyResponseSchema = z.object({ public_key: z.string().nullable() })

export type PushKeyResponse = z.infer<typeof pushKeyResponseSchema>
