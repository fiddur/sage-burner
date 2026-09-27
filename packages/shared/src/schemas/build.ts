import { z } from 'zod'

import { buildPriorities, buildTiers } from '../enums.ts'
import { MAX_NOTES, MAX_TITLE } from '../limits.ts'
import { dateTimeSchema, idSchema, nonEmptyText } from './common.ts'
import { helperSchema } from './membership.ts'
import { supporterSchema } from './thread.ts'

export const buildPersonSchema = z.object({ account_id: idSchema, name: z.string().nullable() })
export type BuildPerson = z.infer<typeof buildPersonSchema>

export const buildItemSchema = z.object({
  id: idSchema,
  project_id: idSchema,
  text: nonEmptyText(MAX_TITLE),
  priority: z.enum(buildPriorities),
  done: z
    .object({ account_id: idSchema.nullable(), name: z.string().nullable(), at: dateTimeSchema })
    .nullable(),
  created_at: dateTimeSchema,
})
export type BuildItem = z.infer<typeof buildItemSchema>

export const buildProjectFields = z.object({
  id: idSchema,
  event_id: idSchema,
  author_account_id: idSchema.nullable(),
  author_name: z.string().nullable(),
  title: nonEmptyText(MAX_TITLE),
  description: z.string().max(MAX_NOTES),
  tier: z.enum(buildTiers),
  order: z.int(),
  withdrawn_at: dateTimeSchema.nullable(),
  created_at: dateTimeSchema,
})

export const buildProjectSchema = buildProjectFields.extend({
  lead: buildPersonSchema.nullable(),
  helpers: z.array(buildPersonSchema),
  items: z.array(buildItemSchema),
  thread_id: idSchema.nullable(),
  supporters: z.array(supporterSchema),
  support_count: z.int(),
  supported_by_me: z.boolean(),
})
export type BuildProject = z.infer<typeof buildProjectSchema>

export const buildProjectsResponseSchema = z.object({ projects: z.array(buildProjectSchema) })
export type BuildProjectsResponse = z.infer<typeof buildProjectsResponseSchema>

export const buildProjectResponseSchema = z.object({ project: buildProjectSchema })
export type BuildProjectResponse = z.infer<typeof buildProjectResponseSchema>

const buildProjectEditable = buildProjectFields.pick({ title: true, description: true, tier: true })

export const buildProjectCreateSchema = buildProjectEditable
  .extend({ description: buildProjectEditable.shape.description.default('') })
  .strict()
export type BuildProjectCreate = z.infer<typeof buildProjectCreateSchema>
export type BuildProjectCreateInput = z.input<typeof buildProjectCreateSchema>

export const buildProjectUpdateSchema = buildProjectEditable.partial().strict()
export type BuildProjectUpdate = z.infer<typeof buildProjectUpdateSchema>

export const buildLeadSchema = z.object({ account_id: idSchema.nullable() }).strict()
export type BuildLead = z.infer<typeof buildLeadSchema>

export const buildHelperSchema = helperSchema
export type BuildHelper = z.infer<typeof buildHelperSchema>

export const buildReorderSchema = z.object({ tier: z.enum(buildTiers), ids: z.array(idSchema) }).strict()
export type BuildReorder = z.infer<typeof buildReorderSchema>

export const buildItemCreateSchema = z
  .object({ text: buildItemSchema.shape.text, priority: buildItemSchema.shape.priority.default('needed') })
  .strict()
export type BuildItemCreate = z.infer<typeof buildItemCreateSchema>
export type BuildItemCreateInput = z.input<typeof buildItemCreateSchema>

export const buildItemUpdateSchema = z
  .object({ text: buildItemSchema.shape.text, priority: buildItemSchema.shape.priority, done: z.boolean() })
  .partial()
  .strict()
export type BuildItemUpdate = z.infer<typeof buildItemUpdateSchema>
