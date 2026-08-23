import { z } from 'zod'

import { idSchema } from './common.ts'
import { connectionSchema } from './connection.ts'

export const personProfileSchema = z.object({
  account_id: idSchema,
  name: z.string().nullable(),
  avatar: z.string().nullable(),
  connections: z.array(connectionSchema),
  contact: z.string().nullable(),
  introduction: z.string().nullable(),
  facebook: z.string().nullable(),
  card_thread_ids: z.array(idSchema),
})

export type PersonProfile = z.infer<typeof personProfileSchema>

export const personProfileResponseSchema = z.object({ person: personProfileSchema })
export type PersonProfileResponse = z.infer<typeof personProfileResponseSchema>

export const approvedAccountsResponseSchema = z.object({
  accounts: z.array(personProfileSchema.pick({ account_id: true, name: true, avatar: true })),
})
export type ApprovedAccountsResponse = z.infer<typeof approvedAccountsResponseSchema>
