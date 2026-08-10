import { z } from 'zod'

import { connectionKinds, isProfileUrl } from '../enums.ts'
import { MAX_CONNECTION_LABEL, MAX_CONNECTION_VALUE } from '../limits.ts'
import { idOrderSchema, idSchema, nonEmptyText } from './common.ts'

export const connectionSchema = z.object({
  id: idSchema,
  account_id: idSchema,
  kind: z.enum(connectionKinds),
  value: nonEmptyText(MAX_CONNECTION_VALUE),
  label: z.string().trim().max(MAX_CONNECTION_LABEL),
  order: z.int().nonnegative(),
})

export type Connection = z.infer<typeof connectionSchema>

export const connectionsResponseSchema = z.object({ connections: z.array(connectionSchema) })
export type ConnectionsResponse = z.infer<typeof connectionsResponseSchema>

export const connectionResponseSchema = z.object({ connection: connectionSchema })
export type ConnectionResponse = z.infer<typeof connectionResponseSchema>

export const connectionCreateSchema = connectionSchema
  .omit({ id: true, account_id: true, order: true })
  .strict()
  .refine((row) => row.kind !== 'link' || isProfileUrl(row.value), {
    error: 'a link must be an https:// address',
    path: ['value'],
  })
  .refine((row) => row.kind !== 'link' || row.label.trim() !== '', {
    error: 'a link needs a name, so the list says what it is',
    path: ['label'],
  })

export type ConnectionCreate = z.infer<typeof connectionCreateSchema>

export const connectionUpdateSchema = connectionCreateSchema

export type ConnectionUpdate = z.infer<typeof connectionUpdateSchema>

export const connectionOrderSchema = idOrderSchema
export type ConnectionOrder = z.infer<typeof connectionOrderSchema>
