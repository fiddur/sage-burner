import { z } from 'zod'

import { accountRoles } from '../enums.ts'
import { MAX_EMAIL, MAX_PERSON_NAME, MIN_PASSWORD } from '../limits.ts'
import { idSchema, nonEmptyText } from './common.ts'

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(MAX_EMAIL))

export const loginPasswordSchema = z.string().min(1).max(1024)

export const newPasswordSchema = z.string().min(MIN_PASSWORD).max(1024)

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: loginPasswordSchema,
})
export type LoginRequest = z.infer<typeof loginRequestSchema>

export const signUpRequestSchema = z
  .object({
    email: emailSchema,
    password: newPasswordSchema,
    name: nonEmptyText(MAX_PERSON_NAME),
  })
  .strict()
export type SignUpRequest = z.infer<typeof signUpRequestSchema>

export const viewerSchema = z.object({
  account_id: idSchema,
  roles: z.array(z.enum(accountRoles)),
  name: z.string().nullable(),
  avatar: z.string().nullable(),
})
export type Viewer = z.infer<typeof viewerSchema>

export const meResponseSchema = z.object({
  viewer: viewerSchema.nullable(),
})
export type MeResponse = z.infer<typeof meResponseSchema>
