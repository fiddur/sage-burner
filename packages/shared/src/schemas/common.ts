import { z } from 'zod'

import { MAX_SLUG } from '../limits.ts'

export const idSchema = z.uuid()

export const dateSchema = z.iso.date()

export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be a 24-hour time, HH:MM')

export const dateTimeSchema = z.iso.datetime()

export const slugSchema = z
  .string()
  .max(MAX_SLUG)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lowercase words separated by single hyphens')

export const nonEmptyText = (max: number) => z.string().trim().min(1).max(max)

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => (value === '' ? null : value))

export const idOrderSchema = z.object({ ids: z.array(idSchema) }).strict()
export type IdOrder = z.infer<typeof idOrderSchema>
