import type {
  BuildItem,
  BuildPerson,
  BuildProject,
  BuildProjectResponse,
  BuildProjectsResponse,
  BuildTier,
  ThreadEntryKind,
} from '@sage-burner/shared'
import type { SQL } from 'drizzle-orm'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import {
  apiRoutes,
  buildHelperSchema,
  buildItemCreateSchema,
  buildItemUpdateSchema,
  buildLeadSchema,
  buildPage,
  buildPriorities,
  buildProjectCreateSchema,
  buildProjectUpdateSchema,
  buildReorderSchema,
  buildTierLabel,
} from '@sage-burner/shared'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'
import type { Notifier } from '../push/notify.ts'

import { accountForAttendance, attendanceFor } from '../attendances.ts'
import { createGuards } from '../auth/guards.ts'
import { viewerFor } from '../auth/viewer.ts'
import { nextOrder, reorder } from '../db/ordered.ts'
import { account, attendance, buildHelper, buildItem, buildProject, thread } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { refuseIfStale, withCollectionVersion } from '../if-match.ts'
import { displayName, tellAttendees } from '../push/notify.ts'
import { openEventNow } from './events.ts'
import { addEntry, heartsFor, openWith, renameThread, threadFor, threadIdFor } from './threads.ts'

export interface BuildDeps extends GuardDeps {
  now: () => Date
  notify?: Notifier
}

type ProjectRow = typeof buildProject.$inferSelect

const author = alias(account, 'build_author')

const listing = (db: Database, where: SQL | undefined) =>
  db
    .select({
      id: buildProject.id,
      event_id: buildProject.event_id,
      author_account_id: buildProject.author_account_id,
      author_name: author.name,
      title: buildProject.title,
      description: buildProject.description,
      tier: buildProject.tier,
      order: buildProject.order,
      withdrawn_at: buildProject.withdrawn_at,
      created_at: buildProject.created_at,
      lead_account_id: account.id,
      lead_name: account.name,
      thread_id: thread.id,
    })
    .from(buildProject)
    .leftJoin(author, eq(author.id, buildProject.author_account_id))
    .leftJoin(attendance, eq(attendance.id, buildProject.lead_attendance_id))
    .leftJoin(account, eq(account.id, attendance.account_id))
    .leftJoin(thread, and(eq(thread.entity_type, 'build'), eq(thread.entity_id, buildProject.id)))
    .where(where)
    .orderBy(asc(buildProject.order), asc(buildProject.created_at), asc(buildProject.id))

const helpersOf = async (db: Database, ids: readonly string[]): Promise<Map<string, BuildPerson[]>> => {
  const rows = await db
    .select({ project_id: buildHelper.project_id, account_id: account.id, name: account.name })
    .from(buildHelper)
    .innerJoin(attendance, eq(attendance.id, buildHelper.attendance_id))
    .innerJoin(account, eq(account.id, attendance.account_id))
    .where(inArray(buildHelper.project_id, [...ids]))
    .orderBy(asc(account.name), asc(account.id))

  const held = new Map<string, BuildPerson[]>()
  for (const row of rows) {
    held.set(row.project_id, [
      ...(held.get(row.project_id) ?? []),
      { account_id: row.account_id, name: row.name },
    ])
  }

  return held
}

const rank = (item: BuildItem): number => buildPriorities.indexOf(item.priority)

const byPriority = (one: BuildItem, other: BuildItem): number =>
  rank(one) - rank(other) || one.created_at.localeCompare(other.created_at) || one.id.localeCompare(other.id)

const itemsOf = async (db: Database, ids: readonly string[]): Promise<Map<string, BuildItem[]>> => {
  const rows = await db
    .select({
      id: buildItem.id,
      project_id: buildItem.project_id,
      text: buildItem.text,
      priority: buildItem.priority,
      done_by: buildItem.done_by_account_id,
      done_by_name: account.name,
      done_at: buildItem.done_at,
      created_at: buildItem.created_at,
    })
    .from(buildItem)
    .leftJoin(account, eq(account.id, buildItem.done_by_account_id))
    .where(inArray(buildItem.project_id, [...ids]))

  const held = new Map<string, BuildItem[]>()
  for (const row of rows) {
    const item: BuildItem = {
      id: row.id,
      project_id: row.project_id,
      text: row.text,
      priority: row.priority,
      done:
        row.done_at === null ? null : { account_id: row.done_by, name: row.done_by_name, at: row.done_at },
      created_at: row.created_at,
    }
    held.set(row.project_id, [...(held.get(row.project_id) ?? []), item])
  }

  for (const [id, items] of held) held.set(id, items.toSorted(byPriority))

  return held
}

const projectsWhere = async (
  db: Database,
  where: SQL | undefined,
  viewerId: string | undefined,
): Promise<BuildProject[]> => {
  const rows = await listing(db, where)
  if (rows.length === 0) return []

  const ids = rows.map((row) => row.id)
  const helpers = await helpersOf(db, ids)
  const items = await itemsOf(db, ids)
  const hearts = await heartsFor(
    db,
    rows.flatMap((row) => (row.thread_id === null ? [] : [row.thread_id])),
  )

  return rows.map(({ lead_account_id, lead_name, ...row }) => {
    const supporters = row.thread_id === null ? [] : (hearts.get(row.thread_id) ?? [])

    return {
      ...row,
      lead: lead_account_id === null ? null : { account_id: lead_account_id, name: lead_name },
      helpers: helpers.get(row.id) ?? [],
      items: items.get(row.id) ?? [],
      supporters,
      support_count: supporters.length,
      supported_by_me: supporters.some((person) => person.account_id === viewerId),
    } satisfies BuildProject
  })
}

const projectRow = async (db: Database, id: string): Promise<ProjectRow | undefined> => {
  const [row] = await db.select().from(buildProject).where(eq(buildProject.id, id)).limit(1)

  return row
}

const inTier = (eventId: string, tier: BuildTier) =>
  and(eq(buildProject.event_id, eventId), eq(buildProject.tier, tier))

const liveInTier = (eventId: string, tier: BuildTier) =>
  and(inTier(eventId, tier), isNull(buildProject.withdrawn_at))

const tick = (done: boolean, by: string | undefined, at: Date) =>
  done
    ? { done_by_account_id: by ?? null, done_at: at.toISOString() }
    : { done_by_account_id: null, done_at: null }

export const registerBuildRoutes = (app: FastifyInstance, deps: BuildDeps) => {
  const { db, sessions, now, notify = async () => undefined } = deps
  const { requireApproved } = createGuards({ db, sessions })

  const callerId = async (request: FastifyRequest) => (await viewerFor(request, { db, sessions }))?.account_id

  const projectsFor = async (eventId: string, viewerId: string | undefined) =>
    await projectsWhere(db, eq(buildProject.event_id, eventId), viewerId)

  const oneProject = async (id: string, viewerId: string | undefined) =>
    (await projectsWhere(db, eq(buildProject.id, id), viewerId))[0]

  const guarded = async (eventId: string) => {
    const rows = await db
      .select({
        id: buildProject.id,
        title: buildProject.title,
        description: buildProject.description,
        tier: buildProject.tier,
        order: buildProject.order,
      })
      .from(buildProject)
      .where(and(eq(buildProject.event_id, eventId), isNull(buildProject.withdrawn_at)))
      .orderBy(
        asc(buildProject.tier),
        asc(buildProject.order),
        asc(buildProject.created_at),
        asc(buildProject.id),
      )

    return { projects: Object.fromEntries(rows.map(({ id, ...editable }) => [id, editable])) }
  }

  const onOpenBurn = async (id: string): Promise<ProjectRow | undefined> => {
    const row = await projectRow(db, id)
    if (row === undefined) return undefined

    return (await openEventNow(db, now, row.event_id)) === undefined ? undefined : row
  }

  const openProject = async (id: string): Promise<ProjectRow | undefined> => {
    const row = await onOpenBurn(id)

    return row?.withdrawn_at === null ? row : undefined
  }

  const openItem = async (itemId: string) => {
    const [item] = await db.select().from(buildItem).where(eq(buildItem.id, itemId)).limit(1)
    if (item === undefined) return undefined

    const project = await openProject(item.project_id)

    return project === undefined ? undefined : { item, project }
  }

  const answer = async (reply: FastifyReply, id: string, viewerId: string | undefined, code = 200) => {
    const project = await oneProject(id, viewerId)
    if (project === undefined) return sendError(reply, 404)

    return reply.code(code).send({ project } satisfies BuildProjectResponse)
  }

  const tell = async (
    by: string | undefined,
    accountId: string | undefined,
    project: ProjectRow,
    message: string,
  ) => {
    if (accountId === undefined || accountId === by) return

    await notify(accountId, {
      category: 'build_role',
      body: message,
      link: buildPage(project.event_id, project.id),
    })
  }

  const noteOnProject = async (
    project: ProjectRow,
    kind: ThreadEntryKind,
    by: string | undefined,
    body: string,
  ) => {
    await addEntry(
      db,
      { thread_id: await threadFor(db, 'build', project), kind, author_account_id: by ?? null, body },
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
    project: ProjectRow,
    by: string | undefined,
    was: string | undefined,
    after: string | null,
  ) => {
    if (was !== undefined && was !== after) {
      await tell(by, was, project, `You are no longer leading ${project.title}.`)
    }
    if (after !== null && after !== was) {
      await tell(by, after, project, `You are now leading ${project.title}.`)
    }

    const said = await leadLine(by, was ?? null, after)
    if (said !== undefined) await noteOnProject(project, 'facilitator', by, said)
  }

  app.get<{ Params: { eventId: string } }>(
    apiRoutes.getBuildProjects.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const { eventId } = request.params
      const projects = await projectsFor(eventId, await callerId(request))

      return await withCollectionVersion(reply, { projects } satisfies BuildProjectsResponse, () =>
        guarded(eventId),
      )
    },
  )

  app.post<{ Params: { eventId: string } }>(
    apiRoutes.addBuildProject.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(buildProjectCreateSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const open = await openEventNow(db, now, request.params.eventId)
      if (open === undefined) return sendError(reply, 404)

      const by = await callerId(request)
      const id = randomUUID()
      const at = now()

      db.transaction((tx) => {
        tx.insert(buildProject)
          .values({
            ...body,
            id,
            event_id: open.id,
            author_account_id: by ?? null,
            order: nextOrder(tx, buildProject, inTier(open.id, body.tier)),
            lead_attendance_id: null,
            withdrawn_at: null,
            created_at: at.toISOString(),
          })
          .run()

        const threadId = threadIdFor(tx, { type: 'build', id, event_id: open.id, title: body.title })

        openWith(
          tx,
          {
            thread_id: threadId,
            kind: 'added',
            author_account_id: by ?? null,
            body: 'added this build project',
          },
          at,
        )
      })

      await tellAttendees(
        db,
        notify,
        open.id,
        { category: 'build_added', body: `A new build project: ${body.title}`, link: buildPage(open.id, id) },
        { except: [by] },
      )

      return await answer(reply, id, by, 201)
    },
  )

  app.patch<{ Params: { id: string } }>(
    apiRoutes.updateBuildProject.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(buildProjectUpdateSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const existing = await openProject(request.params.id)
      if (existing === undefined) return sendError(reply, 404)

      const by = await callerId(request)

      if (Object.keys(body).length === 0) {
        const project = await oneProject(existing.id, by)
        if (project === undefined) return sendError(reply, 404)

        return { project } satisfies BuildProjectResponse
      }

      if (await refuseIfStale(request, reply, () => guarded(existing.event_id))) return reply

      const moved = body.tier !== undefined && body.tier !== existing.tier
      const reworded =
        (body.title !== undefined && body.title !== existing.title) ||
        (body.description !== undefined && body.description !== existing.description)

      db.transaction((tx) => {
        const order =
          moved && body.tier !== undefined
            ? nextOrder(tx, buildProject, inTier(existing.event_id, body.tier))
            : existing.order

        tx.update(buildProject)
          .set({ ...body, order })
          .where(eq(buildProject.id, existing.id))
          .run()
      })

      const after: ProjectRow = { ...existing, ...body }

      if (body.title !== undefined && body.title !== existing.title) {
        await renameThread(db, await threadFor(db, 'build', after), after.title)
      }

      if (reworded) await noteOnProject(after, 'edited', by, 'edited this project')
      else if (moved) await noteOnProject(after, 'edited', by, `moved it to ${buildTierLabel[after.tier]}`)

      const project = await oneProject(existing.id, by)
      if (project === undefined) return sendError(reply, 404)

      return await withCollectionVersion(reply, { project } satisfies BuildProjectResponse, () =>
        guarded(existing.event_id),
      )
    },
  )

  app.delete<{ Params: { id: string } }>(
    apiRoutes.deleteBuildProject.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const existing = await onOpenBurn(request.params.id)
      if (existing === undefined) return sendError(reply, 404)

      if (existing.withdrawn_at === null) {
        await db
          .update(buildProject)
          .set({ withdrawn_at: now().toISOString() })
          .where(eq(buildProject.id, existing.id))

        await noteOnProject(existing, 'withdrawn', await callerId(request), 'took this project off')
      }

      return reply.code(204).send()
    },
  )

  app.post<{ Params: { id: string } }>(
    apiRoutes.restoreBuildProject.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const existing = await onOpenBurn(request.params.id)
      if (existing === undefined) return sendError(reply, 404)

      const by = await callerId(request)

      if (existing.withdrawn_at !== null) {
        db.transaction((tx) => {
          tx.update(buildProject)
            .set({
              withdrawn_at: null,
              order: nextOrder(tx, buildProject, inTier(existing.event_id, existing.tier)),
            })
            .where(eq(buildProject.id, existing.id))
            .run()
        })

        await noteOnProject(existing, 'restored', by, 'brought this project back')
      }

      return await answer(reply, existing.id, by)
    },
  )

  app.put<{ Params: { eventId: string } }>(
    apiRoutes.reorderBuildProjects.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(buildReorderSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const { eventId } = request.params
      if ((await openEventNow(db, now, eventId)) === undefined) return sendError(reply, 404)

      if (await refuseIfStale(request, reply, () => guarded(eventId))) return reply

      const scope = liveInTier(eventId, body.tier)
      const existing = await db.select({ id: buildProject.id }).from(buildProject).where(scope)

      if (reorder(db, buildProject, existing, body.ids, scope) === 'mismatch') return sendError(reply, 400)

      const projects = await projectsFor(eventId, await callerId(request))

      return await withCollectionVersion(reply, { projects } satisfies BuildProjectsResponse, () =>
        guarded(eventId),
      )
    },
  )

  app.put<{ Params: { id: string } }>(
    apiRoutes.setBuildLead.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(buildLeadSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const existing = await openProject(request.params.id)
      if (existing === undefined) return sendError(reply, 404)

      let leadAttendanceId: string | null = null
      if (body.account_id !== null) {
        leadAttendanceId = (await attendanceFor(db, existing.event_id, body.account_id)) ?? null

        if (leadAttendanceId === null) return sendError(reply, 400, 'not_attending')
      }

      await db
        .update(buildProject)
        .set({ lead_attendance_id: leadAttendanceId })
        .where(eq(buildProject.id, existing.id))

      const by = await callerId(request)

      await leadMoved(
        existing,
        by,
        existing.lead_attendance_id === null
          ? undefined
          : await accountForAttendance(db, existing.lead_attendance_id),
        body.account_id,
      )

      return await answer(reply, existing.id, by)
    },
  )

  app.post<{ Params: { id: string } }>(
    apiRoutes.addBuildHelper.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(buildHelperSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const existing = await openProject(request.params.id)
      if (existing === undefined) return sendError(reply, 404)

      const attendanceId = await attendanceFor(db, existing.event_id, body.account_id)
      if (attendanceId === undefined) return sendError(reply, 400, 'not_attending')

      const added = await db
        .insert(buildHelper)
        .values({ project_id: existing.id, attendance_id: attendanceId })
        .onConflictDoNothing()
        .returning({ project_id: buildHelper.project_id })

      const by = await callerId(request)

      if (added.length > 0) {
        await tell(by, body.account_id, existing, `You have been added to helping with ${existing.title}.`)
        await noteOnProject(
          existing,
          'helper',
          by,
          body.account_id === by ? 'is helping' : `asked ${await displayName(db, body.account_id)} to help`,
        )
      }

      return await answer(reply, existing.id, by)
    },
  )

  app.delete<{ Params: { id: string; accountId: string } }>(
    apiRoutes.removeBuildHelper.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const existing = await openProject(request.params.id)
      if (existing === undefined) return sendError(reply, 404)

      const { accountId } = request.params
      const attendanceId = await attendanceFor(db, existing.event_id, accountId)
      if (attendanceId !== undefined) {
        const removed = await db
          .delete(buildHelper)
          .where(and(eq(buildHelper.project_id, existing.id), eq(buildHelper.attendance_id, attendanceId)))
          .returning({ project_id: buildHelper.project_id })

        if (removed.length > 0) {
          const by = await callerId(request)

          await tell(by, accountId, existing, `You have been taken off helping with ${existing.title}.`)
          await noteOnProject(
            existing,
            'helper',
            by,
            accountId === by ? 'stopped helping' : `took ${await displayName(db, accountId)} off helping`,
          )
        }
      }

      return reply.code(204).send()
    },
  )

  app.post<{ Params: { id: string } }>(
    apiRoutes.addBuildItem.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(buildItemCreateSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const existing = await openProject(request.params.id)
      if (existing === undefined) return sendError(reply, 404)

      await db.insert(buildItem).values({
        ...body,
        id: randomUUID(),
        project_id: existing.id,
        done_by_account_id: null,
        done_at: null,
        created_at: now().toISOString(),
      })

      return await answer(reply, existing.id, await callerId(request), 201)
    },
  )

  app.patch<{ Params: { itemId: string } }>(
    apiRoutes.updateBuildItem.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(buildItemUpdateSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const found = await openItem(request.params.itemId)
      if (found === undefined) return sendError(reply, 404)

      const by = await callerId(request)
      const { done, ...wording } = body
      const wasDone = found.item.done_at !== null

      const changes = { ...wording, ...(done === undefined || done === wasDone ? {} : tick(done, by, now())) }

      if (Object.keys(changes).length > 0) {
        await db.update(buildItem).set(changes).where(eq(buildItem.id, found.item.id))
      }

      return await answer(reply, found.project.id, by)
    },
  )

  app.delete<{ Params: { itemId: string } }>(
    apiRoutes.deleteBuildItem.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const found = await openItem(request.params.itemId)
      if (found === undefined) return sendError(reply, 404)

      await db.delete(buildItem).where(eq(buildItem.id, found.item.id))

      return reply.code(204).send()
    },
  )
}
