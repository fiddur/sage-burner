import { z } from 'zod'

import { effortLevels } from '../enums.ts'
import { MAX_NOTES, MAX_TITLE } from '../limits.ts'
import { idSchema, nonEmptyText } from './common.ts'
import { copyFromSchema } from './copy.ts'
import { helperSchema } from './membership.ts'

/**
 * A lead role for one burn — the spreadsheet's roles tab.
 *
 * `purpose` and `tasks` are markdown, like every longer field shown to other
 * people. `markdown.ts` escapes raw HTML rather than filtering it, so a member
 * author is inside what it defends against.
 */
export const leadRoleFields = z.object({
  id: idSchema,
  event_id: idSchema,
  title: nonEmptyText(MAX_TITLE),
  purpose: z.string().max(MAX_NOTES),
  tasks: z.string().max(MAX_NOTES),
  effort_before: z.enum(effortLevels),
  effort_during: z.enum(effortLevels),
  effort_after: z.enum(effortLevels),
  /** People wanted *besides* the lead. Zero means lead-only. Advisory, never a cap. */
  team_size_wanted: z.int().min(0),
  created_at: z.string(),
})

/**
 * A role as a member sees it: who leads it and who is on it, by name.
 *
 * Names resolved at read time rather than stored — the account carries the person,
 * and a name corrected on the profile page is corrected here too.
 */
export const leadRoleSchema = leadRoleFields.extend({
  lead: z.object({ account_id: idSchema, name: z.string().nullable() }).nullable(),
  team: z.array(z.object({ account_id: idSchema, name: z.string().nullable() })),
})

export const leadRolesResponseSchema = z.object({ roles: z.array(leadRoleSchema) })
export const leadRoleResponseSchema = z.object({ role: leadRoleSchema })

/**
 * What a member may set on a role, carrying **no defaults**.
 *
 * Derived from `leadRoleFields` so each bound has one home, and defaults-free so
 * `.partial()` below actually produces a partial. Zod 4's `.partial()` does not
 * suppress a default: an optional wrapping a default still produces the default and
 * the object parser keeps the key. Built from the create schema, `{ effort_during:
 * 'high' }` parsed to all six other fields as well, so changing one effort level
 * wiped the purpose, the tasks and the wanted team size — and `{}` parsed to six
 * keys, so the handler's no-op branch was unreachable. `formQuestionUpdateSchema`
 * documents the same trap.
 */
const leadRoleEditableFields = leadRoleFields.omit({ id: true, event_id: true, created_at: true })

/**
 * Adding a role.
 *
 * The effort answers and the team size default, so somebody adding a title and a
 * purpose is not stopped by three selects they have no opinion on yet. `.strict()`
 * so a misspelt field is a 400 rather than a silently defaulted one.
 *
 * The defaults live here and nowhere else. On a PATCH "absent" means "leave it
 * alone"; only on a create does it mean "use this".
 */
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

/** Editing one. Partial — omitted fields are left as they are. */
export const leadRoleUpdateSchema = leadRoleEditableFields.partial().strict()

/**
 * Taking a role, handing it to somebody, or vacating it.
 *
 * `null` vacates. An id must belong to somebody attending this burn, which the
 * route checks — the reference is to their attendance, so the database refuses
 * anyone else anyway.
 */
export const leadRoleLeadSchema = z.object({ account_id: idSchema.nullable() }).strict()

/** Adding or removing a team member. The same body the other two groups take. */
export const leadRoleTeamSchema = helperSchema

/**
 * Seeding a new burn's register from a previous burn's.
 *
 * Definitions only — titles, purpose, tasks, effort, team sizes — and never people:
 * who led the sauna last summer is a fact about last summer. Fifteen roles retyped
 * four times a year is the friction this removes.
 *
 * The body and the source list are `copy.ts`'s, shared with the schedule's places.
 */
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
