import type {
  CopySourcesResponse,
  LeadRole,
  LeadRoleResponse,
  LeadRolesResponse,
  ThreadEntryKind,
} from '@sage-burner/shared'
import type { FastifyInstance, FastifyRequest } from 'fastify'

import {
  apiRoutes,
  leadRoleCopySchema,
  leadRoleCreateSchema,
  leadRoleLeadSchema,
  leadRoleTeamSchema,
  leadRoleUpdateSchema,
  rolesPage,
} from '@sage-burner/shared'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'
import type { Notifier } from '../push/notify.ts'

import { accountForAttendance, attendanceFor } from '../attendances.ts'
import { createGuards } from '../auth/guards.ts'
import { viewerFor } from '../auth/viewer.ts'
import { isForeignKeyViolation } from '../db/errors.ts'
import { account, attendance, event, leadRole, leadRoleMember } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { refuseIfStale, withCollectionVersion, withVersion } from '../if-match.ts'
import { displayName, tellAttendees } from '../push/notify.ts'
import { copySourcesFor } from './copy-sources.ts'
import { openEventNow } from './events.ts'
import { addEntry, forgetThread, openWith, threadFor, threadIdFor } from './threads.ts'

export interface LeadRoleDeps extends GuardDeps {
  now: () => Date
  notify?: Notifier
}

const rolesFor = async (db: Database, eventId: string): Promise<LeadRole[]> => {
  const rows = await db
    .select({
      id: leadRole.id,
      event_id: leadRole.event_id,
      title: leadRole.title,
      purpose: leadRole.purpose,
      tasks: leadRole.tasks,
      effort_before: leadRole.effort_before,
      effort_during: leadRole.effort_during,
      effort_after: leadRole.effort_after,
      team_size_wanted: leadRole.team_size_wanted,
      created_at: leadRole.created_at,
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
        rows.map((row) => row.id),
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

  return rows.map(({ leadAccountId, leadName, ...role }) => ({
    ...role,
    lead: leadAccountId === null ? null : { account_id: leadAccountId, name: leadName },
    team: teamByRole.get(role.id) ?? [],
  }))
}

const roleRow = async (db: Database, id: string) => {
  const [row] = await db.select().from(leadRole).where(eq(leadRole.id, id)).limit(1)
  return row
}

export const registerLeadRoleRoutes = (app: FastifyInstance, deps: LeadRoleDeps) => {
  const { db, sessions, now, notify = async () => undefined } = deps
  const { requireApproved } = createGuards({ db, sessions })

  const register = async (eventId: string): Promise<LeadRolesResponse> => ({
    roles: await rolesFor(db, eventId),
  })

  const openRole = async (id: string) => {
    const row = await roleRow(db, id)
    if (row === undefined) return undefined

    return (await openEventNow(db, now, row.event_id)) === undefined ? undefined : row
  }

  const tell = async (
    by: string | undefined,
    accountId: string | undefined,
    eventId: string,
    message: string,
  ) => {
    if (accountId === undefined || accountId === by) return

    await notify(accountId, { category: 'lead_role', body: message, link: rolesPage(eventId) })
  }

  const noteOnRole = async (
    role: { id: string; event_id: string; title: string },
    kind: ThreadEntryKind,
    by: string | undefined,
    body: string,
  ) => {
    await addEntry(
      db,
      { thread_id: await threadFor(db, 'role', role), kind, author_account_id: by ?? null, body },
      now(),
    )
  }

  const leadLine = async (by: string | undefined, was: string | null, after: string | null) => {
    if (after === null) {
      if (was === null) return undefined

      return was === by ? 'stepped back from leading it' : `took ${await displayName(db, was)} off leading it`
    }

    if (after === was) return undefined
    if (after === by) return was === null ? 'is leading it' : 'took over as lead'

    return `asked ${await displayName(db, after)} to lead it`
  }

  const leadMoved = async (
    role: { id: string; event_id: string; title: string },
    by: string | undefined,
    was: string | undefined,
    after: string | null,
  ) => {
    if (was !== undefined && was !== after) {
      await tell(by, was, role.event_id, `You are no longer ${role.title} lead.`)
    }
    if (after !== null && after !== was) {
      await tell(by, after, role.event_id, `You are now ${role.title} lead.`)
    }

    const said = await leadLine(by, was ?? null, after)
    if (said !== undefined) await noteOnRole(role, 'facilitator', by, said)

    if (after === null || after === was) return

    await tellAttendees(
      db,
      notify,
      role.event_id,
      {
        category: 'lead_role_filled',
        body: `${await displayName(db, after)} is now ${role.title} lead.`,
        link: rolesPage(role.event_id),
      },
      { except: [by, after] },
    )
  }

  const callerId = async (request: FastifyRequest) => (await viewerFor(request, { db, sessions }))?.account_id

  app.get<{ Params: { eventId: string } }>(
    apiRoutes.getLeadRoles.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      return withVersion(reply, await register(request.params.eventId))
    },
  )

  app.post<{ Params: { eventId: string } }>(
    apiRoutes.addLeadRole.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(leadRoleCreateSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const fields = {
        ...body,
        id: randomUUID(),
        event_id: request.params.eventId,
        created_at: now().toISOString(),
      }

      const by = await callerId(request)

      try {
        db.transaction((tx) => {
          tx.insert(leadRole)
            .values({ ...fields, lead_attendance_id: null })
            .run()

          const threadId = threadIdFor(tx, {
            type: 'role',
            id: fields.id,
            event_id: fields.event_id,
            title: fields.title,
          })

          openWith(
            tx,
            {
              thread_id: threadId,
              kind: 'added',
              author_account_id: by ?? null,
              body: 'added this lead role',
            },
            now(),
          )
        })
      } catch (failure) {
        if (isForeignKeyViolation(failure)) return sendError(reply, 404)
        throw failure
      }

      await tellAttendees(
        db,
        notify,
        fields.event_id,
        {
          category: 'lead_role_added',
          body: `A new lead role: ${fields.title}`,
          link: rolesPage(fields.event_id),
        },
        { except: [by] },
      )

      const role: LeadRole = { ...fields, lead: null, team: [] }

      return reply.code(201).send({ role } satisfies LeadRoleResponse)
    },
  )

  app.patch<{ Params: { id: string } }>(
    apiRoutes.updateLeadRole.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(leadRoleUpdateSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const existing = await openRole(request.params.id)
      if (existing === undefined) return sendError(reply, 404)

      if (Object.keys(body).length > 0) {
        if (await refuseIfStale(request, reply, () => register(existing.event_id))) return reply

        await db.update(leadRole).set(body).where(eq(leadRole.id, request.params.id))
      }

      const roles = await rolesFor(db, existing.event_id)
      const role = roles.find((candidate) => candidate.id === request.params.id)
      if (role === undefined) return sendError(reply, 404)

      return await withCollectionVersion(reply, { role } satisfies LeadRoleResponse, () =>
        register(existing.event_id),
      )
    },
  )

  app.delete<{ Params: { id: string } }>(
    apiRoutes.deleteLeadRole.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      if ((await openRole(request.params.id)) === undefined) {
        return sendError(reply, 404)
      }

      const deleted = db.transaction((tx) => {
        const gone = tx
          .delete(leadRole)
          .where(eq(leadRole.id, request.params.id))
          .returning({ id: leadRole.id })
          .all()

        if (gone.length > 0) forgetThread(tx, 'role', request.params.id)

        return gone
      })

      return deleted.length === 0 ? sendError(reply, 404) : reply.code(204).send()
    },
  )

  app.put<{ Params: { id: string } }>(
    apiRoutes.setLeadRoleLead.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(leadRoleLeadSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const existing = await openRole(request.params.id)
      if (existing === undefined) return sendError(reply, 404)

      let leadAttendanceId: string | null = null
      if (body.account_id !== null) {
        leadAttendanceId = (await attendanceFor(db, existing.event_id, body.account_id)) ?? null

        if (leadAttendanceId === null) return sendError(reply, 400, 'not_attending')
      }

      await db
        .update(leadRole)
        .set({ lead_attendance_id: leadAttendanceId })
        .where(eq(leadRole.id, request.params.id))

      await leadMoved(
        existing,
        await callerId(request),
        existing.lead_attendance_id === null
          ? undefined
          : await accountForAttendance(db, existing.lead_attendance_id),
        body.account_id,
      )

      const roles = await rolesFor(db, existing.event_id)
      const role = roles.find((candidate) => candidate.id === request.params.id)
      if (role === undefined) return sendError(reply, 404)

      return { role } satisfies LeadRoleResponse
    },
  )

  app.post<{ Params: { id: string } }>(
    apiRoutes.joinLeadRoleTeam.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(leadRoleTeamSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const existing = await openRole(request.params.id)
      if (existing === undefined) return sendError(reply, 404)

      const attendanceId = await attendanceFor(db, existing.event_id, body.account_id)
      if (attendanceId === undefined) return sendError(reply, 400, 'not_attending')

      const added = await db
        .insert(leadRoleMember)
        .values({ role_id: request.params.id, attendance_id: attendanceId })
        .onConflictDoNothing()
        .returning({ role_id: leadRoleMember.role_id })

      if (added.length > 0) {
        const by = await callerId(request)

        await tell(
          by,
          body.account_id,
          existing.event_id,
          `You have been added to the ${existing.title} team.`,
        )
        await noteOnRole(
          existing,
          'helper',
          by,
          body.account_id === by
            ? 'joined the team'
            : `asked ${await displayName(db, body.account_id)} onto the team`,
        )
      }

      const roles = await rolesFor(db, existing.event_id)
      const role = roles.find((candidate) => candidate.id === request.params.id)
      if (role === undefined) return sendError(reply, 404)

      return { role } satisfies LeadRoleResponse
    },
  )

  app.delete<{ Params: { id: string; accountId: string } }>(
    apiRoutes.leaveLeadRoleTeam.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const existing = await openRole(request.params.id)
      if (existing === undefined) return sendError(reply, 404)

      const attendanceId = await attendanceFor(db, existing.event_id, request.params.accountId)
      if (attendanceId !== undefined) {
        const removed = await db
          .delete(leadRoleMember)
          .where(
            and(
              eq(leadRoleMember.role_id, request.params.id),
              eq(leadRoleMember.attendance_id, attendanceId),
            ),
          )
          .returning({ role_id: leadRoleMember.role_id })

        if (removed.length > 0) {
          const by = await callerId(request)

          await tell(
            by,
            request.params.accountId,
            existing.event_id,
            `You have been taken off the ${existing.title} team.`,
          )
          await noteOnRole(
            existing,
            'helper',
            by,
            request.params.accountId === by
              ? 'left the team'
              : `took ${await displayName(db, request.params.accountId)} off the team`,
          )
        }
      }

      return reply.code(204).send()
    },
  )

  app.get<{ Params: { eventId: string } }>(
    apiRoutes.getLeadRoleSources.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const sources = await copySourcesFor(
        db,
        { table: leadRole, eventColumn: leadRole.event_id, idColumn: leadRole.id },
        request.params.eventId,
      )

      return { sources } satisfies CopySourcesResponse
    },
  )

  app.post<{ Params: { eventId: string } }>(
    apiRoutes.copyLeadRoles.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(leadRoleCopySchema, request)
      if (body === undefined) return sendError(reply, 400)
      if (body.from_event_id === request.params.eventId) {
        return sendError(reply, 400)
      }

      const stamp = now().toISOString()
      const by = await callerId(request)
      const seeded = db.transaction((tx) => {
        const [burn] = tx
          .select({ id: event.id })
          .from(event)
          .where(eq(event.id, request.params.eventId))
          .limit(1)
          .all()

        if (burn === undefined) return 'not_found' as const

        const [from] = tx
          .select({ id: event.id })
          .from(event)
          .where(eq(event.id, body.from_event_id))
          .limit(1)
          .all()

        if (from === undefined) return 'not_found' as const

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
          .where(eq(leadRole.event_id, body.from_event_id))
          .orderBy(asc(leadRole.created_at), asc(leadRole.id))
          .all()

        const startedAt = Date.parse(stamp)

        source.forEach((row, index) => {
          const id = randomUUID()
          const at = new Date(startedAt + index)

          tx.insert(leadRole)
            .values({
              id,
              event_id: request.params.eventId,
              title: row.title,
              purpose: row.purpose,
              tasks: row.tasks,
              effort_before: row.effort_before,
              effort_during: row.effort_during,
              effort_after: row.effort_after,
              team_size_wanted: row.team_size_wanted,
              lead_attendance_id: null,
              created_at: at.toISOString(),
            })
            .run()

          const card = threadIdFor(tx, {
            type: 'role',
            id,
            event_id: request.params.eventId,
            title: row.title,
          })

          openWith(
            tx,
            { thread_id: card, kind: 'added', author_account_id: by ?? null, body: 'added this lead role' },
            at,
          )
        })

        return 'copied' as const
      })

      if (seeded === 'not_found') return sendError(reply, 404)
      if (seeded === 'conflict') return sendError(reply, 409)

      return reply
        .code(201)
        .send({ roles: await rolesFor(db, request.params.eventId) } satisfies LeadRolesResponse)
    },
  )
}
