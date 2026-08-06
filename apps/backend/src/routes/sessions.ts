import type { Session, SessionResponse, SessionsResponse } from '@sage-burner/shared'
import type { FastifyInstance, FastifyRequest } from 'fastify'

import {
  apiRoutes,
  errorResponse,
  helperSchema,
  hasValidTimeSlot,
  sessionCreateSchema,
  sessionUpdateSchema,
} from '@sage-burner/shared'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { GuardDeps } from '../auth/guards.ts'
import type { Database } from '../db/index.ts'

import { createGuards } from '../auth/guards.ts'
import { viewerFor } from '../auth/viewer.ts'
import { isForeignKeyViolation } from '../db/errors.ts'
import {
  account,
  accountAvatar,
  attendance,
  place,
  session,
  sessionHelper,
  sessionSupport,
} from '../db/schema.ts'
import { noStore } from '../http.ts'
import { attendanceFor } from './attendance.ts'
import { openEvent, todayIso } from './events.ts'

export interface SessionDeps extends GuardDeps {
  now?: () => Date
  /**
   * Told when somebody is put on a dream, or taken off one, by anybody but
   * themselves. Optional and swallowing its own failures, like the lead-roles
   * register: offering a pair of hands is the point and the notification is a
   * courtesy, so a push service being down must not fail the write.
   */
  notify?: (accountId: string, message: string) => Promise<unknown>
}

type DreamRow = typeof session.$inferSelect

interface People {
  helpers: ReadonlyMap<string, Session['helpers']>
  support: ReadonlyMap<string, { people: Session['supporters']; mine: boolean }>
}

/**
 * Who is helping with these dreams, and who has given them a ❤️‍🔥.
 *
 * Two queries for the whole list rather than two per dream, like `rolesFor`.
 */
const peopleFor = async (db: Database, ids: string[], mine: string | undefined): Promise<People> => {
  const helpers = new Map<string, Session['helpers']>()
  const support = new Map<string, { people: Session['supporters']; mine: boolean }>()

  // Two queries that can only answer nothing. Drizzle renders the empty `inArray`
  // harmlessly — this skips the round trips, it does not prevent an error.
  if (ids.length === 0) return { helpers, support }

  const helperRows = await db
    .select({ dreamId: sessionHelper.session_id, accountId: account.id, name: account.name })
    .from(sessionHelper)
    .innerJoin(attendance, eq(attendance.id, sessionHelper.attendance_id))
    .innerJoin(account, eq(account.id, attendance.account_id))
    .where(inArray(sessionHelper.session_id, ids))
    .orderBy(asc(account.name), asc(account.id))

  const supportRows = await db
    .select({
      dreamId: sessionSupport.session_id,
      attendanceId: sessionSupport.attendance_id,
      accountId: account.id,
      name: account.name,
      avatar: accountAvatar.updated_at,
    })
    .from(sessionSupport)
    .innerJoin(attendance, eq(attendance.id, sessionSupport.attendance_id))
    .innerJoin(account, eq(account.id, attendance.account_id))
    .leftJoin(accountAvatar, eq(accountAvatar.account_id, account.id))
    .where(inArray(sessionSupport.session_id, ids))
    .orderBy(asc(account.name), asc(account.id))

  for (const row of helperRows) {
    helpers.set(row.dreamId, [
      ...(helpers.get(row.dreamId) ?? []),
      { account_id: row.accountId, name: row.name },
    ])
  }

  for (const row of supportRows) {
    const sofar = support.get(row.dreamId) ?? { people: [], mine: false }
    support.set(row.dreamId, {
      people: [...sofar.people, { account_id: row.accountId, name: row.name, avatar: row.avatar }],
      mine: sofar.mine || row.attendanceId === mine,
    })
  }

  return { helpers, support }
}

/**
 * A stored dream as a reader sees it.
 *
 * Field by field rather than a spread of the row, like `asMemberEntry`: a spread is
 * exempt from excess-property checking, so a column added to `session` would reach
 * every reader of the schedule without anybody naming it here.
 */
const asDream = (row: DreamRow, { helpers, support }: People): Session => ({
  id: row.id,
  event_id: row.event_id,
  title: row.title,
  facilitator_account_id: row.facilitator_account_id,
  description: row.description,
  repeatable: row.repeatable,
  time_slot_start: row.time_slot_start,
  time_slot_end: row.time_slot_end,
  place_id: row.place_id,
  helpers: helpers.get(row.id) ?? [],
  supporters: support.get(row.id)?.people ?? [],
  // Kept beside the list rather than derived by every reader: the grid's chip shows
  // the number where there is no room for faces.
  support_count: support.get(row.id)?.people.length ?? 0,
  supported_by_me: support.get(row.id)?.mine ?? false,
})

const sessionsFor = async (db: Database, eventId: string, mine: string | undefined): Promise<Session[]> => {
  const rows = await db
    .select()
    .from(session)
    .where(eq(session.event_id, eventId))
    // Unscheduled dreams last, then by when they happen. `asc` puts nulls first
    // in SQLite, so the null-ness is sorted on explicitly rather than relied on.
    .orderBy(asc(isNull(session.time_slot_start)), asc(session.time_slot_start), asc(session.title))

  const people = await peopleFor(
    db,
    rows.map((row) => row.id),
    mine,
  )

  return rows.map((row) => asDream(row, people))
}

const oneDream = async (db: Database, row: DreamRow, mine: string | undefined): Promise<Session> =>
  asDream(row, await peopleFor(db, [row.id], mine))

interface Refusal {
  code: 400 | 404
  error: 'bad_request' | 'not_found'
}

interface Attending {
  dream: DreamRow
  attendanceId: string
  /** Who is asking, so a write on somebody else's behalf can tell them. */
  callerId: string | undefined
}

/**
 * Whether a place belongs to the burn a dream is on.
 *
 * The foreign key cannot say this: it only knows the place exists, and since #156
 * a place belongs to one burn. Without the check a body could put a dream in
 * another burn's lane — a lane the grid does not draw, so the dream would vanish
 * from the page while still holding a row.
 *
 * `null` is always fine: that is "not scheduled anywhere yet", which is where most
 * dreams sit until close to the burn.
 */
const placeIsOnThisBurn = async (db: Database, eventId: string, placeId: string | null | undefined) => {
  if (placeId == null) return true

  const [found] = await db
    .select({ id: place.id })
    .from(place)
    .where(and(eq(place.id, placeId), eq(place.event_id, eventId)))
    .limit(1)

  return found !== undefined
}

/**
 * Whether a facilitator is coming to the burn their dream is at.
 *
 * Somebody who is not there cannot run it, and the foreign key only knows the
 * account exists. `null` is always fine: most dreams start with nobody.
 */
const facilitatorIsComing = async (db: Database, eventId: string, accountId: string | null | undefined) =>
  accountId == null || (await attendanceFor(db, eventId, accountId)) !== undefined

/**
 * Dreams — the member-offered workshops, ceremonies and happenings.
 *
 * A null time slot means *offered but not yet scheduled*, which is the normal
 * state for most of them right up until the burn, not an error.
 *
 * Members rather than admins, because the schedule is theirs to arrange: #20
 * says any member can administrate it — including handing a dream to the member who
 * will facilitate it, which is a body field rather than something to prevent.
 */
export const registerSessionRoutes = (
  app: FastifyInstance,
  { db, sessions, now = () => new Date(), notify = async () => undefined }: SessionDeps,
) => {
  const { requireMember } = createGuards({ db, sessions })

  /** The caller's attendance at a burn, or nothing if they are not coming to it. */
  const mineAt = async (request: FastifyRequest, eventId: string) => {
    const viewer = await viewerFor(request, { db, sessions })

    return viewer === undefined ? undefined : await attendanceFor(db, eventId, viewer.account_id)
  }

  /**
   * Facilitating is a role somebody else can put you in or take you out of, so it is
   * told like the rest. Only when the field was sent *and* moved — a PATCH fixing a
   * typo in the title must not announce anything.
   */
  const facilitatorMoved = async (
    request: FastifyRequest,
    before: { title: string; facilitator_account_id: string | null },
    after: string | null | undefined,
  ) => {
    if (after === undefined || after === before.facilitator_account_id) return

    const viewer = await viewerFor(request, { db, sessions })
    const was = before.facilitator_account_id

    if (was !== null) await tell(viewer?.account_id, was, `You are no longer facilitating ${before.title}`)
    if (after !== null) await tell(viewer?.account_id, after, `You are facilitating ${before.title}`)
  }

  /** Tell somebody, unless they did it themselves. Same rule as the register. */
  const tell = async (by: string | undefined, accountId: string, message: string) => {
    if (accountId === by) return

    await notify(accountId, message)
  }

  app.get<{ Params: { eventId: string } }>(
    apiRoutes.getSessions.fastify,
    { preHandler: requireMember },
    async (request, reply) => {
      void noStore(reply)

      // Reading a finished burn's dreams is reading its record, so this is not
      // scoped the way the writes below are. An empty list for an id that names
      // nothing is the same answer as for a burn nobody offered anything at.
      const mine = await mineAt(request, request.params.eventId)

      return { sessions: await sessionsFor(db, request.params.eventId, mine) } satisfies SessionsResponse
    },
  )

  app.post<{ Params: { eventId: string } }>(
    apiRoutes.offerSession.fastify,
    { preHandler: requireMember },
    async (request, reply) => {
      void noStore(reply)

      const parsed = sessionCreateSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

      const viewer = await viewerFor(request, { db, sessions })
      if (viewer === undefined) return reply.code(401).send(errorResponse('unauthenticated'))

      const open = await openEvent(db, todayIso(now), request.params.eventId)
      if (open === undefined) return reply.code(404).send(errorResponse('not_found'))

      if (!(await placeIsOnThisBurn(db, open.id, parsed.data.place_id))) {
        return reply.code(400).send(errorResponse('bad_request'))
      }
      if (!(await facilitatorIsComing(db, open.id, parsed.data.facilitator_account_id))) {
        return reply.code(400).send(errorResponse('bad_request'))
      }

      const row: DreamRow = {
        ...parsed.data,
        id: randomUUID(),
        event_id: open.id,
      }

      // Split deliberately. The foreign key is the authority on the place *existing*,
      // including a concurrent delete a pre-read would miss; `placeIsOnThisBurn` above
      // decides the pairing, which the key cannot see. That check cannot go stale in
      // the direction that matters — no route moves a place between burns, since
      // `placeUpdateSchema` omits `event_id`.
      try {
        await db.insert(session).values(row)
      } catch (failure) {
        if (isForeignKeyViolation(failure)) return reply.code(400).send(errorResponse('bad_request'))
        throw failure
      }

      // Built from what was written rather than read back: a new dream has nobody
      // helping and no hearts by definition.
      const dream: Session = {
        ...row,
        helpers: [],
        supporters: [],
        support_count: 0,
        supported_by_me: false,
      }

      return reply.code(201).send({ session: dream } satisfies SessionResponse)
    },
  )

  app.patch<{ Params: { id: string } }>(
    apiRoutes.updateSession.fastify,
    { preHandler: requireMember },
    async (request, reply) => {
      void noStore(reply)

      const parsed = sessionUpdateSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

      const [existing] = await db.select().from(session).where(eq(session.id, request.params.id)).limit(1)

      // Scoped to a burn that has not ended, like every other member-facing write:
      // a dream from a finished burn is history, and an id noted while it was
      // current should not still be a way to rewrite it. Not the *active* burn —
      // the selector offers every burn still to come, and a dream can be offered
      // for the one after next.
      const open = existing === undefined ? undefined : await openEvent(db, todayIso(now), existing.event_id)
      if (existing === undefined || open === undefined) {
        return reply.code(404).send(errorResponse('not_found'))
      }

      const mine = await mineAt(request, existing.event_id)

      if (Object.keys(parsed.data).length === 0) {
        return { session: await oneDream(db, existing, mine) } satisfies SessionResponse
      }

      // The rule applied to the row as it would be, because a body carrying one
      // end of the slot cannot be judged on its own — `hasValidTimeSlot` is the
      // same check the schema makes when both ends are present. Not composed
      // into the WHERE: these are ISO instants, and comparing them as SQL
      // strings is wrong when the ends differ in fractional-second precision.
      if (!hasValidTimeSlot({ ...existing, ...parsed.data })) {
        return reply.code(400).send(errorResponse('bad_request'))
      }

      if (!(await placeIsOnThisBurn(db, existing.event_id, parsed.data.place_id))) {
        return reply.code(400).send(errorResponse('bad_request'))
      }
      if (!(await facilitatorIsComing(db, existing.event_id, parsed.data.facilitator_account_id))) {
        return reply.code(400).send(errorResponse('bad_request'))
      }

      let updated: DreamRow[]
      try {
        updated = await db
          .update(session)
          .set(parsed.data)
          .where(eq(session.id, request.params.id))
          .returning()
      } catch (failure) {
        if (isForeignKeyViolation(failure)) return reply.code(400).send(errorResponse('bad_request'))
        throw failure
      }

      const [row] = updated

      await facilitatorMoved(request, existing, parsed.data.facilitator_account_id)

      return row === undefined
        ? reply.code(404).send(errorResponse('not_found'))
        : ({ session: await oneDream(db, row, mine) } satisfies SessionResponse)
    },
  )

  app.delete<{ Params: { id: string } }>(
    apiRoutes.withdrawSession.fastify,
    { preHandler: requireMember },
    async (request, reply) => {
      void noStore(reply)

      const [existing] = await db
        .select({ event_id: session.event_id })
        .from(session)
        .where(eq(session.id, request.params.id))
        .limit(1)

      const open = existing === undefined ? undefined : await openEvent(db, todayIso(now), existing.event_id)
      if (open === undefined) return reply.code(404).send(errorResponse('not_found'))

      const deleted = await db
        .delete(session)
        .where(and(eq(session.id, request.params.id), eq(session.event_id, open.id)))
        .returning({ id: session.id })

      if (deleted.length === 0) return reply.code(404).send(errorResponse('not_found'))

      return reply.code(204).send()
    },
  )

  /**
   * The dream and the caller's place at its burn, or the answer to give instead.
   *
   * A caller who is not coming to that burn is a **400**, not a 403: they may well
   * be a member in good standing, and what is wrong is the pairing.
   */
  const asAttendee = async (
    request: FastifyRequest<{ Params: { id: string } }>,
  ): Promise<Refusal | Attending> => {
    const [dream] = await db.select().from(session).where(eq(session.id, request.params.id)).limit(1)
    if (dream === undefined) return { code: 404, error: 'not_found' }

    const open = await openEvent(db, todayIso(now), dream.event_id)
    if (open === undefined) return { code: 404, error: 'not_found' }

    const attendanceId = await mineAt(request, dream.event_id)
    if (attendanceId === undefined) return { code: 400, error: 'bad_request' }

    const viewer = await viewerFor(request, { db, sessions })

    return { dream, attendanceId, callerId: viewer?.account_id }
  }

  /**
   * Offering a pair of hands, and taking the offer back — yours or somebody
   * else's (#247).
   *
   * It names a person rather than being `/me`, like the lead-roles register: at 42
   * people who all know each other, "I will put you down for that" is a thing said
   * out loud, and the register has worked that way from the start. What keeps it
   * civil is that the person is told, which is what `tell` is for.
   *
   * The **caller** still has to be coming to the burn, and so does whoever they
   * name — a dream is run by people who are there.
   */
  app.post<{ Params: { id: string } }>(
    apiRoutes.helpWithSession.fastify,
    { preHandler: requireMember },
    async (request, reply) => {
      void noStore(reply)

      const parsed = helperSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

      const found = await asAttendee(request)
      if ('code' in found) return reply.code(found.code).send(errorResponse(found.error))

      const theirs = await attendanceFor(db, found.dream.event_id, parsed.data.account_id)
      if (theirs === undefined) return reply.code(400).send(errorResponse('bad_request'))

      await db
        .insert(sessionHelper)
        .values({ session_id: found.dream.id, attendance_id: theirs })
        .onConflictDoNothing()

      await tell(found.callerId, parsed.data.account_id, `You are helping with ${found.dream.title}`)

      return { session: await oneDream(db, found.dream, found.attendanceId) } satisfies SessionResponse
    },
  )

  app.delete<{ Params: { id: string; accountId: string } }>(
    apiRoutes.stopHelpingWithSession.fastify,
    { preHandler: requireMember },
    async (request, reply) => {
      void noStore(reply)

      const found = await asAttendee(request)
      if ('code' in found) return reply.code(found.code).send(errorResponse(found.error))

      const theirs = await attendanceFor(db, found.dream.event_id, request.params.accountId)
      if (theirs === undefined) return reply.code(400).send(errorResponse('bad_request'))

      const gone = await db
        .delete(sessionHelper)
        .where(and(eq(sessionHelper.session_id, found.dream.id), eq(sessionHelper.attendance_id, theirs)))
        .returning()

      // Only when a row actually went: taking somebody off a dream they were never
      // on would otherwise tell them they had been dropped from it.
      if (gone.length > 0) {
        await tell(
          found.callerId,
          request.params.accountId,
          `You are no longer helping with ${found.dream.title}`,
        )
      }

      return { session: await oneDream(db, found.dream, found.attendanceId) } satisfies SessionResponse
    },
  )

  /**
   * A ❤️‍🔥, and taking it back.
   *
   * Nothing is notified: forty hearts arriving as notifications would teach people
   * to ignore the channel.
   */
  app.post<{ Params: { id: string } }>(
    apiRoutes.supportSession.fastify,
    { preHandler: requireMember },
    async (request, reply) => {
      void noStore(reply)

      const found = await asAttendee(request)
      if ('code' in found) return reply.code(found.code).send(errorResponse(found.error))

      await db
        .insert(sessionSupport)
        .values({ session_id: found.dream.id, attendance_id: found.attendanceId })
        .onConflictDoNothing()

      return { session: await oneDream(db, found.dream, found.attendanceId) } satisfies SessionResponse
    },
  )

  app.delete<{ Params: { id: string } }>(
    apiRoutes.withdrawSupportForSession.fastify,
    { preHandler: requireMember },
    async (request, reply) => {
      void noStore(reply)

      const found = await asAttendee(request)
      if ('code' in found) return reply.code(found.code).send(errorResponse(found.error))

      await db
        .delete(sessionSupport)
        .where(
          and(
            eq(sessionSupport.session_id, found.dream.id),
            eq(sessionSupport.attendance_id, found.attendanceId),
          ),
        )

      return { session: await oneDream(db, found.dream, found.attendanceId) } satisfies SessionResponse
    },
  )
}
