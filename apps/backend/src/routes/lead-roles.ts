import type { CopySourcesResponse, LeadRole, LeadRoleResponse, LeadRolesResponse } from '@sage-burner/shared'
import type { FastifyInstance, FastifyRequest } from 'fastify'

import {
  apiRoutes,
  leadRoleCopySchema,
  leadRoleCreateSchema,
  leadRoleLeadSchema,
  leadRoleTeamSchema,
  leadRoleUpdateSchema,
} from '@sage-burner/shared'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'
import type { Notifier } from '../push/notify.ts'

import { createGuards } from '../auth/guards.ts'
import { viewerFor } from '../auth/viewer.ts'
import { isForeignKeyViolation } from '../db/errors.ts'
import { account, attendance, event, leadRole, leadRoleMember } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { refuseIfStale, withVersion } from '../if-match.ts'
import { displayName, notifyAttendees } from '../push/notify.ts'
import { accountForAttendance, attendanceFor } from './attendance.ts'
import { copySourcesFor } from './copy-sources.ts'
import { openEvent, todayIso } from './events.ts'

export interface LeadRoleDeps extends GuardDeps {
  now?: () => Date
  /**
   * Tell somebody something happened to them here.
   *
   * Injected rather than imported so the suite never reaches a push service, and
   * so the routes below say *what* is worth telling somebody without also owning
   * *how*. Defaults to doing nothing: notifying is a courtesy, and a register that
   * refused to hand out a role because delivery was unavailable would be worse
   * than a quiet one.
   */
  notify?: Notifier
}

/**
 * The register for one burn, with the people resolved.
 *
 * Two queries rather than one per role: the whole register is read at once by the
 * page, and a loop of selects would be the slower way to say the same thing.
 */
const rolesFor = async (db: Database, eventId: string): Promise<LeadRole[]> => {
  // The columns, not the row. A spread of `leadRole` carried `lead_attendance_id`
  // into every response — an internal id `leadRoleSchema` does not declare, which
  // neither `satisfies LeadRolesResponse` nor the `Promise<LeadRole[]>` annotation
  // catches, because an object spread is exempt from excess-property checking. It is
  // the same "a route selecting two columns cannot leak a third" argument that made
  // `/events/:eventId/attendees` its own route.
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

/**
 * The lead-roles register — who is looking after what at this burn.
 *
 * Every route here is `requireApproved`, removals included; `lead_role`'s own doc
 * says why that divergence was chosen and what it costs.
 *
 * **Reads need a role too**, which is the part not visible from the table: the
 * register names members, so unlike the schedule it is not public.
 */
export const registerLeadRoleRoutes = (app: FastifyInstance, deps: LeadRoleDeps) => {
  const { db, sessions, now = () => new Date(), notify = async () => undefined } = deps
  const { requireApproved } = createGuards({ db, sessions })

  /** The register, as both the `GET` and the `If-Match` guard see it (#274). */
  const register = async (eventId: string): Promise<LeadRolesResponse> => ({
    roles: await rolesFor(db, eventId),
  })

  /**
   * The role, if its burn has not ended.
   *
   * The rule every member-facing write keyed by a bare id is scoped by, resolved from
   * the row — `openEvent`, not `activeEvent`, because the register is filled in months
   * ahead. A finished burn's register is the record of who looked after what, and an
   * id noted while it was current should not still be a way to rewrite it.
   *
   * `docs/burns.md` said this was already so (#219). It was not: the register was the one
   * bare-id family with no such check, while `places.ts`, `sessions.ts` and `meals.ts`
   * all had one.
   */
  const openRole = async (id: string) => {
    const row = await roleRow(db, id)
    if (row === undefined) return undefined

    return (await openEvent(db, todayIso(now), row.event_id)) === undefined ? undefined : row
  }

  /**
   * Tell somebody, unless they did it themselves.
   *
   * Taking a role you want is the common case, and a notification for your own click
   * is noise that teaches people to ignore the channel. Awaited rather than fired and
   * forgotten: an unawaited rejection would escape as an unhandled promise rejection,
   * and `notify` already swallows delivery failure.
   *
   * Takes the caller's account id rather than the request, so a handover — which
   * notifies both ends — resolves the viewer once instead of once per notification.
   */
  const tell = async (by: string, accountId: string | undefined, message: string) => {
    if (accountId === undefined || accountId === by) return

    await notify(accountId, { category: 'lead_role', body: message, link: '/roles' })
  }

  /** Who is asking, for `tell`. Undefined never matches an account id, so it notifies. */
  const callerId = async (request: FastifyRequest) =>
    (await viewerFor(request, { db, sessions }))?.account_id ?? ''

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

      try {
        await db
          .insert(leadRole)
          .values({ ...fields, lead_attendance_id: null })
          .run()
      } catch (failure) {
        // A burn that does not exist. The foreign key is the authority rather than a
        // pre-read, which would be a second query saying the same thing.
        if (isForeignKeyViolation(failure)) return sendError(reply, 404)
        throw failure
      }

      // Everybody coming to that burn, minus whoever added it (#259). No name in the
      // body: a new role is vacant, so there is nobody it is about yet.
      await notifyAttendees(
        db,
        notify,
        fields.event_id,
        { category: 'lead_role_added', body: `A new lead role: ${fields.title}`, link: '/roles' },
        { except: await callerId(request) },
      )

      // Built from what was written rather than read back: a new role is vacant and
      // has no team by definition, so a re-read would only be a query that could
      // fail to find its own insert and need an impossible branch for it.
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

      // `set({})` is not valid SQL, so an empty body reads instead of writing. A
      // no-op PATCH is idempotent; answering with the row unchanged is honest — and
      // a read needs no precondition, which is why the guard is inside the branch.
      if (Object.keys(body).length > 0) {
        if (await refuseIfStale(request, reply, () => register(existing.event_id))) return reply

        await db.update(leadRole).set(body).where(eq(leadRole.id, request.params.id))
      }

      const roles = await rolesFor(db, existing.event_id)
      const role = roles.find((candidate) => candidate.id === request.params.id)
      if (role === undefined) return sendError(reply, 404)

      return { role } satisfies LeadRoleResponse
    },
  )

  app.delete<{ Params: { id: string } }>(
    apiRoutes.deleteLeadRole.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      // Read before the delete purely for the scope check: this route had no lookup
      // at all, deleting straight from the id, so it was the one write here that the
      // `openRole` sweep could not reach by replacing a call.
      if ((await openRole(request.params.id)) === undefined) {
        return sendError(reply, 404)
      }

      const deleted = await db
        .delete(leadRole)
        .where(eq(leadRole.id, request.params.id))
        .returning({ id: leadRole.id })

      // The team goes with it — `lead_role_member` cascades — which is the point of
      // letting any member remove one: the role is the thing, not the sign-ups.
      return deleted.length === 0 ? sendError(reply, 404) : reply.code(204).send()
    },
  )

  /**
   * Taking a role, handing it to somebody, or vacating it.
   *
   * One route for all three because they are one write: the lead is a column, and
   * "take" and "assign" differ only in whose id is in the body. `null` vacates.
   */
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

        // Not coming to this burn. A 400 rather than a 404: the account may well
        // exist, and what is wrong is the pairing.
        if (leadAttendanceId === null) return sendError(reply, 400)
      }

      await db
        .update(leadRole)
        .set({ lead_attendance_id: leadAttendanceId })
        .where(eq(leadRole.id, request.params.id))

      // Both ends of the handover, since one write can move a role off one person
      // and onto another and each of them wants to know. The caller is resolved once
      // for the pair rather than once per notification.
      const by = await callerId(request)
      const before =
        existing.lead_attendance_id === null
          ? undefined
          : await accountForAttendance(db, existing.lead_attendance_id)

      if (before !== undefined && before !== body.account_id) {
        await tell(by, before, `You are no longer ${existing.title} lead.`)
      }
      if (body.account_id !== null && body.account_id !== before) {
        await tell(by, body.account_id, `You are now ${existing.title} lead.`)
      }

      // The burn-wide half, separate from the two personal notes above: those tell the
      // people it happened *to*, this tells everyone who asked to follow the register
      // filling up (#259). Only on a spot being taken — a role falling vacant is not
      // news worth pushing to forty-two people, and whoever lost it is told directly.
      if (body.account_id !== null && body.account_id !== before) {
        await notifyAttendees(
          db,
          notify,
          existing.event_id,
          {
            category: 'lead_role_filled',
            body: `${await displayName(db, body.account_id)} is now ${existing.title} lead.`,
            link: '/roles',
          },
          { except: by },
        )
      }

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
      if (attendanceId === undefined) return sendError(reply, 400)

      // Joining twice is the same as joining once. `team_size_wanted` is advisory, so
      // there is deliberately no capacity check here — an extra pair of hands is not
      // something to refuse.
      await db
        .insert(leadRoleMember)
        .values({ role_id: request.params.id, attendance_id: attendanceId })
        .onConflictDoNothing()

      await tell(
        await callerId(request),
        body.account_id,
        `You have been added to the ${existing.title} team.`,
      )

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

        // Only when a row actually went. This route is idempotent, so removing
        // somebody who was never on the team is a 204 — and telling them they have
        // been taken off something they were not on is worse than saying nothing.
        if (removed.length > 0) {
          await tell(
            await callerId(request),
            request.params.accountId,
            `You have been taken off the ${existing.title} team.`,
          )
        }
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
      const seeded = db.transaction((tx) => {
        // Checked rather than left to the foreign key. The FK only fires when there
        // is a row to insert, so copying from an empty source into a burn that does
        // not exist answered 201 with an empty list — the one combination the other
        // 404 test cannot reach.
        const [burn] = tx
          .select({ id: event.id })
          .from(event)
          .where(eq(event.id, request.params.eventId))
          .limit(1)
          .all()

        if (burn === undefined) return 'not_found' as const

        // The source too, and for the same reason. Without it, copying *from* a burn
        // that does not exist answered 201 with nothing copied — no different from a
        // real burn that simply has none.
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

        // A millisecond per row, in source order. `rolesFor` sorts by
        // `(created_at, id)`, so one shared stamp left the tie-break to a random
        // UUID and a copied register came out shuffled — which also made the
        // `orderBy` above decorative, a sort nothing downstream could observe.
        const startedAt = Date.parse(stamp)

        source.forEach((row, index) => {
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
              created_at: new Date(startedAt + index).toISOString(),
            })
            .run()
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
