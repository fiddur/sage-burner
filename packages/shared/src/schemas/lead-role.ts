import { z } from 'zod'

import { effortLevels } from '../enums.ts'
import { MAX_NOTES, MAX_TITLE } from '../limits.ts'
import { idSchema, nonEmptyText } from './common.ts'
import { copyFromSchema } from './copy.ts'
import { helperSchema } from './membership.ts'

export const leadRoleFields = z.object({
  id: idSchema,
  event_id: idSchema,
  title: nonEmptyText(MAX_TITLE),
  purpose: z.string().max(MAX_NOTES),
  tasks: z.string().max(MAX_NOTES),
  effort_before: z.enum(effortLevels),
  effort_during: z.enum(effortLevels),
  effort_after: z.enum(effortLevels),
  team_size_wanted: z.int().min(0),
  created_at: z.string(),
})

export const leadRoleSchema = leadRoleFields.extend({
  lead: z.object({ account_id: idSchema, name: z.string().nullable() }).nullable(),
  team: z.array(z.object({ account_id: idSchema, name: z.string().nullable() })),
})

export const leadRolesResponseSchema = z.object({ roles: z.array(leadRoleSchema) })
export const leadRoleResponseSchema = z.object({ role: leadRoleSchema })

const leadRoleEditableFields = leadRoleFields.omit({ id: true, event_id: true, created_at: true })

export const leadRoleCreateSchema = leadRoleEditableFields
  .extend({
    purpose: leadRoleEditableFields.shape.purpose.default(''),
    tasks: leadRoleEditableFields.shape.tasks.default(''),
    effort_before: leadRoleEditableFields.shape.effort_before.default('none'),
    effort_during: leadRoleEditableFields.shape.effort_during.default('none'),
    effort_after: leadRoleEditableFields.shape.effort_after.default('none'),
    team_size_wanted: leadRoleEditableFields.shape.team_size_wanted.default(0),
  })
  .strict()

export const leadRoleUpdateSchema = leadRoleEditableFields.partial().strict()

export const leadRoleLeadSchema = z.object({ account_id: idSchema.nullable() }).strict()

export const leadRoleTeamSchema = helperSchema

export const leadRoleCopySchema = copyFromSchema

export type LeadRole = z.infer<typeof leadRoleSchema>
export type LeadRolesResponse = z.infer<typeof leadRolesResponseSchema>
export type LeadRoleResponse = z.infer<typeof leadRoleResponseSchema>
export type LeadRoleCreate = z.infer<typeof leadRoleCreateSchema>
export type LeadRoleCreateInput = z.input<typeof leadRoleCreateSchema>
export type LeadRoleUpdate = z.infer<typeof leadRoleUpdateSchema>
export type LeadRoleLead = z.infer<typeof leadRoleLeadSchema>
export type LeadRoleTeam = z.infer<typeof leadRoleTeamSchema>
export type LeadRoleCopy = z.infer<typeof leadRoleCopySchema>
