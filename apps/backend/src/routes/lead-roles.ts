import type {
  LeadRole,
  LeadRoleResponse,
  LeadRolesResponse,
  LeadRoleSourcesResponse,
} from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import {
  errorResponse,
  leadRoleCopySchema,
  leadRoleCreateSchema,
  leadRoleLeadSchema,
  leadRoleTeamSchema,
  leadRoleUpdateSchema,
} from '@sage-burner/shared'
import { and, asc, count, desc, eq, inArray, ne } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'

import { createGuards } from '../auth/guards.ts'
import { isForeignKeyViolation } from '../db/errors.ts'
import { account, attendance, event, leadRole, leadRoleMember } from '../db/schema.ts'
import { noStore } from '../http.ts'

export interface LeadRoleDeps extends GuardDeps {
  now?: () => Date
}

/** Whose attendance an account holds at this burn, or nothing if they are not coming. */
const attendanceFor = async (db: Database, eventId: string, accountId: string) => {
  const [row] = await db
    .select({ id: attendance.id })
    .from(attendance)
    .where(and(eq(attendance.event_id, eventId), eq(attendance.account_id, accountId)))
    .limit(1)

  return row?.id
}

/**
 * The register for one burn, with the people resolved.
 *
 * Two queries rather than one per role: the whole register is read at once by the
 * page, and a loop of selects would be the slower way to say the same thing.
 */
const rolesFor = async (db: Database, eventId: string): Promise<LeadRole[]> => {
  const rows = await db
    .select({
      role: leadRole,
      leadAccountId: account.id,
      leadName: account.name,
    })
    .from(leadRole)
    .leftJoin(attendance, eq(attendance.id, leadRole.lead_attendance_id))
    .leftJoin(account, eq(account.id, attendance.account_id))
    .where(eq(leadRole.event_id, eventId))
    .orderBy(asc(leadRole.created_at), asc(leadRole.id))

  if (rows.length === 0) return []

  const teamRows = await db
    .select({
      roleId: leadRoleMember.role_id,
      accountId: account.id,
      name: account.name,
    })
    .from(leadRoleMember)
    .innerJoin(attendance, eq(attendance.id, leadRoleMember.attendance_id))
    .innerJoin(account, eq(account.id, attendance.account_id))
    .where(
      inArray(
        leadRoleMember.role_id,
        rows.map((row) => row.role.id),
      ),
    )
    .orderBy(asc(account.name), asc(account.id))

  const teamByRole = new Map<string, { account_id: string; name: string | null }[]>()
  for (const row of teamRows) {
    teamByRole.set(row.roleId, [
      ...(teamByRole.get(row.roleId) ?? []),
      { account_id: row.accountId, name: row.name },
    ])
  }

  return rows.map(({ role, leadAccountId, leadName }) => ({
    ...role,
    lead: leadAccountId === null ? null : { account_id: leadAccountId, name: leadName },
    team: teamByRole.get(role.id) ?? [],
  }))
}

const roleOr404 = async (db: Database, id: string) => {
  const [row] = await db.select().from(leadRole).where(eq(leadRole.id, id)).limit(1)
  return row
}

/**
 * The lead-roles register — who is looking after what at this burn.
 *
 * **Open to any approved member, including removing a role somebody else staffed.**
 * That is the deliberate answer for a co-created event replacing a shared
 * spreadsheet, and it is the same trust the lodging and helping lists assume. There
 * is no undo.
 *
 * Reads need a role too: the register names members, so it is not public the way the
 * schedule is.
 */
export const registerLeadRoleRoutes = (app: FastifyInstance, deps: LeadRoleDeps) => {
  const { db, sessions, now = () => new Date() } = deps
  const { requireApproved } = createGuards({ db, sessions })

  app.get<{ Params: { eventId: string } }>(
    '/api/events/:eventId/roles',
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      return { roles: await rolesFor(db, request.params.eventId) } satisfies LeadRolesResponse
    },
  )

  app.post<{ Params: { eventId: string } }>(
    '/api/events/:eventId/roles',
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const parsed = leadRoleCreateSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

      const row = {
        ...parsed.data,
        id: randomUUID(),
        event_id: request.params.eventId,
        lead_attendance_id: null,
        created_at: now().toISOString(),
      }

      try {
        await db.insert(leadRole).values(row).run()
      } catch (failure) {
        // A burn that does not exist. The foreign key is the authority rather than a
        // pre-read, which would be a second query saying the same thing.
        if (isForeignKeyViolation(failure)) return reply.code(404).send(errorResponse('not_found'))
        throw failure
      }

      // Built from what was written rather than read back: a new role is vacant and
      // has no team by definition, so a re-read would only be a query that could
      // fail to find its own insert and need an impossible branch for it.
      const role: LeadRole = { ...row, lead: null, team: [] }

      return reply.code(201).send({ role } satisfies LeadRoleResponse)
    },
  )

  app.patch<{ Params: { id: string } }>(
    '/api/roles/:id',
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const parsed = leadRoleUpdateSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

      const existing = await roleOr404(db, request.params.id)
      if (existing === undefined) return reply.code(404).send(errorResponse('not_found'))

      // `set({})` is not valid SQL, so an empty body reads instead of writing. A
      // no-op PATCH is idempotent; answering with the row unchanged is honest.
      if (Object.keys(parsed.data).length > 0) {
        await db.update(leadRole).set(parsed.data).where(eq(leadRole.id, request.params.id))
      }

      const roles = await rolesFor(db, existing.event_id)
      const role = roles.find((candidate) => candidate.id === request.params.id)
      if (role === undefined) return reply.code(404).send(errorResponse('not_found'))

      return { role } satisfies LeadRoleResponse
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/api/roles/:id',
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const deleted = await db
        .delete(leadRole)
        .where(eq(leadRole.id, request.params.id))
        .returning({ id: leadRole.id })

      // The team goes with it — `lead_role_member` cascades — which is the point of
      // letting any member remove one: the role is the thing, not the sign-ups.
      return deleted.length === 0 ? reply.code(404).send(errorResponse('not_found')) : reply.code(204).send()
    },
  )

  /**
   * Taking a role, handing it to somebody, or vacating it.
   *
   * One route for all three because they are one write: the lead is a column, and
   * "take" and "assign" differ only in whose id is in the body. `null` vacates.
   */
  app.put<{ Params: { id: string } }>(
    '/api/roles/:id/lead',
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const parsed = leadRoleLeadSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

      const existing = await roleOr404(db, request.params.id)
      if (existing === undefined) return reply.code(404).send(errorResponse('not_found'))

      let leadAttendanceId: string | null = null
      if (parsed.data.account_id !== null) {
        leadAttendanceId = (await attendanceFor(db, existing.event_id, parsed.data.account_id)) ?? null

        // Not coming to this burn. A 400 rather than a 404: the account may well
        // exist, and what is wrong is the pairing.
        if (leadAttendanceId === null) return reply.code(400).send(errorResponse('bad_request'))
      }

      await db
        .update(leadRole)
        .set({ lead_attendance_id: leadAttendanceId })
        .where(eq(leadRole.id, request.params.id))

      const roles = await rolesFor(db, existing.event_id)
      const role = roles.find((candidate) => candidate.id === request.params.id)
      if (role === undefined) return reply.code(404).send(errorResponse('not_found'))

      return { role } satisfies LeadRoleResponse
    },
  )

  app.post<{ Params: { id: string } }>(
    '/api/roles/:id/team',
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const parsed = leadRoleTeamSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

      const existing = await roleOr404(db, request.params.id)
      if (existing === undefined) return reply.code(404).send(errorResponse('not_found'))

      const attendanceId = await attendanceFor(db, existing.event_id, parsed.data.account_id)
      if (attendanceId === undefined) return reply.code(400).send(errorResponse('bad_request'))

      // Joining twice is the same as joining once. `team_size_wanted` is advisory, so
      // there is deliberately no capacity check here — an extra pair of hands is not
      // something to refuse.
      await db
        .insert(leadRoleMember)
        .values({ role_id: request.params.id, attendance_id: attendanceId })
        .onConflictDoNothing()

      const roles = await rolesFor(db, existing.event_id)
      const role = roles.find((candidate) => candidate.id === request.params.id)
      if (role === undefined) return reply.code(404).send(errorResponse('not_found'))

      return { role } satisfies LeadRoleResponse
    },
  )

  app.delete<{ Params: { id: string; accountId: string } }>(
    '/api/roles/:id/team/:accountId',
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const existing = await roleOr404(db, request.params.id)
      if (existing === undefined) return reply.code(404).send(errorResponse('not_found'))

      const attendanceId = await attendanceFor(db, existing.event_id, request.params.accountId)
      if (attendanceId !== undefined) {
        await db
          .delete(leadRoleMember)
          .where(
            and(
              eq(leadRoleMember.role_id, request.params.id),
              eq(leadRoleMember.attendance_id, attendanceId),
            ),
          )
      }

      return reply.code(204).send()
    },
  )

  /**
   * The burns this register could be seeded from, newest first.
   *
   * Only burns that already have a register, and only their name — the admin event
   * list is not readable here, and a burn's dates and cap are not this page's
   * business. Without it the copy control would have nothing to offer.
   */
  app.get<{ Params: { eventId: string } }>(
    '/api/events/:eventId/roles/sources',
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const sources = await db
        .select({ event_id: event.id, name: event.name, roles: count(leadRole.id) })
        .from(event)
        .innerJoin(leadRole, eq(leadRole.event_id, event.id))
        .where(ne(event.id, request.params.eventId))
        .groupBy(event.id)
        .orderBy(desc(event.start_date), asc(event.slug))

      return { sources } satisfies LeadRoleSourcesResponse
    },
  )

  /**
   * Seed this burn's register from a previous burn's.
   *
   * Definitions only, never people: who led the sauna last summer is a fact about
   * last summer. Refuses when this burn already has roles — merging two registers
   * is a decision nobody asked for, and "copy into empty" is the case that removes
   * the retyping.
   *
   * The emptiness check and the inserts are one transaction, or that refusal is not
   * true: two members clicking the button between separate awaits both read an empty
   * register and both seed it, so it holds every role twice. `places.ts` wraps its
   * order assignment for the same reason.
   *
   * **Do not expect a test to hold this.** `inject` runs requests to completion in
   * turn, so a version reading outside the transaction answers `[201, 409]` under
   * `Promise.all` exactly as this one does; the 409 test covers the sequential case
   * and nothing covers the window.
   */
  app.post<{ Params: { eventId: string } }>(
    '/api/events/:eventId/roles/copy',
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const parsed = leadRoleCopySchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))
      if (parsed.data.from_event_id === request.params.eventId) {
        return reply.code(400).send(errorResponse('bad_request'))
      }

      const stamp = now().toISOString()
      let seeded: 'conflict' | 'copied'
      try {
        seeded = db.transaction((tx) => {
          const [already] = tx
            .select({ id: leadRole.id })
            .from(leadRole)
            .where(eq(leadRole.event_id, request.params.eventId))
            .limit(1)
            .all()

          if (already !== undefined) return 'conflict' as const

          const source = tx
            .select()
            .from(leadRole)
            .where(eq(leadRole.event_id, parsed.data.from_event_id))
            .orderBy(asc(leadRole.created_at), asc(leadRole.id))
            .all()

          for (const row of source) {
            tx.insert(leadRole)
              .values({
                id: randomUUID(),
                event_id: request.params.eventId,
                title: row.title,
                purpose: row.purpose,
                tasks: row.tasks,
                effort_before: row.effort_before,
                effort_during: row.effort_during,
                effort_after: row.effort_after,
                team_size_wanted: row.team_size_wanted,
                lead_attendance_id: null,
                created_at: stamp,
              })
              .run()
          }

          return 'copied' as const
        })
      } catch (failure) {
        if (isForeignKeyViolation(failure)) return reply.code(404).send(errorResponse('not_found'))
        throw failure
      }

      if (seeded === 'conflict') return reply.code(409).send(errorResponse('conflict'))

      return reply
        .code(201)
        .send({ roles: await rolesFor(db, request.params.eventId) } satisfies LeadRolesResponse)
    },
  )
}
