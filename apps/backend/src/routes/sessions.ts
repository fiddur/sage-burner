import type {
  Session,
  SessionResponse,
  SessionsResponse,
  SessionUpdate,
  ThreadEntryKind,
} from '@sage-burner/shared'
import type { SQL } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'

import {
  apiRoutes,
  dreamPage,
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
import type { Notifier } from '../push/notify.ts'

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
  thread,
} from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { refuseIfStale, withCollectionVersion, withVersion } from '../if-match.ts'
import { displayName, tellAttendees } from '../push/notify.ts'
import { attendanceFor } from './attendance.ts'
import { openEventNow } from './events.ts'
import { addEntry, renameThread, threadForSession, threadIdFor } from './threads.ts'

export interface SessionDeps extends GuardDeps {
  now: () => Date
  /**
   * Told when somebody is put on a dream, or taken off one, by anybody but
   * themselves. Optional and swallowing its own failures, like the lead-roles
   * register: offering a pair of hands is the point and the notification is a
   * courtesy, so a push service being down must not fail the write.
   */
  notify?: Notifier
}

/**
 * A dream as the routes handle it: the stored row, with the facilitator resolved
 * back to an account id.
 *
 * The column is an `attendance`, so that leaving a burn empties the spot by foreign
 * key rather than by a route remembering to. Every reader wants the person, though,
 * and the wire field has always been an account id — `dreamColumns` is where the two
 * meet, and it is the only place that knows the difference.
 */
type DreamRow = Omit<typeof session.$inferSelect, 'facilitator_attendance_id'> & {
  facilitator_account_id: string | null
  thread_id: string | null
}

const dreamColumns = {
  id: session.id,
  event_id: session.event_id,
  title: session.title,
  facilitator_account_id: attendance.account_id,
  description: session.description,
  repeatable: session.repeatable,
  time_slot_start: session.time_slot_start,
  time_slot_end: session.time_slot_end,
  place_id: session.place_id,
  thread_id: thread.id,
}

/** Left, so a dream nobody runs is still a dream — and so is one with no thread yet. */
const dreamRows = (db: Database, where: SQL) =>
  db
    .select(dreamColumns)
    .from(session)
    .leftJoin(attendance, eq(attendance.id, session.facilitator_attendance_id))
    .leftJoin(thread, and(eq(thread.entity_type, 'session'), eq(thread.entity_id, session.id)))
    .where(where)

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
  thread_id: row.thread_id,
  helpers: helpers.get(row.id) ?? [],
  supporters: support.get(row.id)?.people ?? [],
  // Kept beside the list rather than derived by every reader: the grid's chip shows
  // the number where there is no room for faces.
  support_count: support.get(row.id)?.people.length ?? 0,
  supported_by_me: support.get(row.id)?.mine ?? false,
})

/**
 * What a scheduling change says, with no clock in it.
 *
 * The server does not know the reader's timezone, so a formatted time written into a
 * stored line would be Saturday in UTC and Sunday morning for somebody east of it. The
 * dream itself says when; this says that somebody moved it.
 */
const scheduleLine = (before: DreamRow, after: DreamRow): string => {
  if (before.time_slot_start === null && after.time_slot_start !== null) return 'put it in the schedule'
  if (before.time_slot_start !== null && after.time_slot_start === null) return 'took it off the schedule'

  return 'moved it in the schedule'
}

const sessionsFor = async (db: Database, eventId: string, mine: string | undefined): Promise<Session[]> => {
  const rows = await dreamRows(db, eq(session.event_id, eventId))
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

interface Arranging {
  dream: DreamRow
  /** The caller's own attendance, which shapes the answer but gates nothing here. */
  mine: string | undefined
  /** Who is asking, so a write on somebody else's behalf can tell them. */
  callerId: string | undefined
}

interface Attending extends Arranging {
  mine: string
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
 * The facilitator's place at the burn their dream is at, or a refusal.
 *
 * Somebody who is not there cannot run it. `undefined` means the body did not
 * mention the field and nothing should be written; `null` means a dream nobody runs,
 * which is how most of them start.
 */
type Spot = { ok: true; attendanceId: string | null | undefined } | { ok: false }

const facilitatorSpot = async (
  db: Database,
  eventId: string,
  accountId: string | null | undefined,
): Promise<Spot> => {
  if (accountId === undefined) return { ok: true, attendanceId: undefined }
  if (accountId === null) return { ok: true, attendanceId: null }

  const found = await attendanceFor(db, eventId, accountId)

  return found === undefined ? { ok: false } : { ok: true, attendanceId: found }
}

/**
 * Dreams — the member-offered workshops, ceremonies and happenings.
 *
 * A null time slot means *offered but not yet scheduled*, which is the normal
 * state for most of them right up until the burn, not an error.
 *
 * Open to anyone who is in, not to admins: the schedule is the members' to arrange
 * (#20), including handing a dream to whoever will facilitate it, which is a body
 * field rather than something to prevent.
 *
 * `requireApproved` rather than `requireMember`, so an organiser holding `admin`
 * without `member` is not shut out of the burn they are setting up (#200). The
 * selector already offers them every coming burn, so a `member`-only guard let them
 * choose one and then refused them its timetable — while the lanes, the register and
 * the options next to it were open. Taking a job **yourself** still needs an attendance
 * at that burn, and so does whoever somebody else is put down for (#350); the checks
 * below answer that with a 400, which is a different sentence from "you are not welcome
 * here".
 */
export const registerSessionRoutes = (
  app: FastifyInstance,
  { db, sessions, now, notify = async () => undefined }: SessionDeps,
) => {
  const { requireApproved } = createGuards({ db, sessions })

  /**
   * The pool, as both the `GET` and the `If-Match` guard see it (#274).
   *
   * Per viewer, because `sessionsFor` is: whether a dream is yours changes the row.
   * That is fine — each browser quotes back the tag it was given.
   */
  const dreamsOf = async (eventId: string, mine: string | undefined): Promise<SessionsResponse> => ({
    sessions: await sessionsFor(db, eventId, mine),
  })

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
    by: string | undefined,
    before: DreamRow,
    after: string | null | undefined,
  ) => {
    if (after === undefined || after === before.facilitator_account_id) return

    const was = before.facilitator_account_id

    if (was !== null) await tell(by, was, `You are no longer facilitating ${before.title}`)
    if (after !== null) await tell(by, after, `You are facilitating ${before.title}`)

    const line = await facilitatorLine(by, was, after)
    if (line !== undefined) await noteOnDream(before, 'facilitator', by, line)
  }

  /**
   * The same change, in the third person, for the thread.
   *
   * A second wording rather than the notification's: that one is addressed to whoever it
   * happened to — "You are facilitating" — and a thread is read by everybody else. The
   * subject's name is written into it where there is one, which is the one name here
   * that does not come from the account when the line is read. A line about a past
   * appointment naming somebody's old name is history; the card's title is not, which is
   * why that one is resolved live.
   */
  const facilitatorLine = async (by: string | undefined, was: string | null, after: string | null) => {
    if (after === null) {
      if (was === null) return undefined

      return was === by
        ? 'stepped back from facilitating'
        : `took ${await displayName(db, was)} off facilitating`
    }

    if (after === by) return was === null ? 'is facilitating it' : 'took over as facilitator'

    return `asked ${await displayName(db, after)} to facilitate`
  }

  /** Tell somebody, unless they did it themselves. Same rule as the register. */
  const tell = async (by: string | undefined, accountId: string, message: string) => {
    if (accountId === by) return

    await notify(accountId, { category: 'dream_role', body: message, link: '/dreams' })
  }

  /** A line on the dream's own thread (#375), by whoever is doing it. */
  const noteOnDream = async (
    dream: { id: string; event_id: string; title: string },
    kind: ThreadEntryKind,
    by: string | undefined,
    body: string,
  ) => {
    await addEntry(
      db,
      { thread_id: await threadForSession(db, dream), kind, author_account_id: by ?? null, body },
      now(),
    )
  }

  /**
   * What a save changed, as quiet lines beside the talk.
   *
   * One per aspect that actually moved rather than one line trying to say everything: a
   * rename followed by a move keeps both, while `coalesces` folds an afternoon of drags
   * into a single scheduling line. A field sent unchanged says nothing — the grid sends
   * the whole dream on every save.
   */
  const dreamEdited = async (
    before: DreamRow,
    body: SessionUpdate,
    after: DreamRow,
    by: string | undefined,
  ) => {
    if (body.title !== undefined && body.title !== before.title) {
      await noteOnDream(before, 'renamed', by, `renamed it to “${after.title}”`)
      await renameThread(db, await threadForSession(db, before), after.title)
    }

    const moved =
      (body.time_slot_start !== undefined && body.time_slot_start !== before.time_slot_start) ||
      (body.time_slot_end !== undefined && body.time_slot_end !== before.time_slot_end) ||
      (body.place_id !== undefined && body.place_id !== before.place_id)

    if (moved) await noteOnDream(before, 'scheduled', by, scheduleLine(before, after))

    const detailed =
      (body.description !== undefined && body.description !== before.description) ||
      (body.repeatable !== undefined && body.repeatable !== before.repeatable)

    if (detailed) await noteOnDream(before, 'edited', by, 'edited the details')
  }

  app.get<{ Params: { eventId: string } }>(
    apiRoutes.getSessions.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      // Reading a finished burn's dreams is reading its record, so this is not
      // scoped the way the writes below are. An empty list for an id that names
      // nothing is the same answer as for a burn nobody offered anything at.
      const mine = await mineAt(request, request.params.eventId)

      return withVersion(reply, await dreamsOf(request.params.eventId, mine))
    },
  )

  app.post<{ Params: { eventId: string } }>(
    apiRoutes.offerSession.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(sessionCreateSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const viewer = await viewerFor(request, { db, sessions })
      if (viewer === undefined) return sendError(reply, 401)

      const open = await openEventNow(db, now, request.params.eventId)
      if (open === undefined) return sendError(reply, 404)

      if (!(await placeIsOnThisBurn(db, open.id, body.place_id))) {
        return sendError(reply, 400)
      }
      const spot = await facilitatorSpot(db, open.id, body.facilitator_account_id)
      if (!spot.ok) return sendError(reply, 400)

      const { facilitator_account_id: wanted, ...fields } = body
      const row: DreamRow = {
        ...fields,
        id: randomUUID(),
        event_id: open.id,
        facilitator_account_id: wanted ?? null,
        thread_id: null,
      }

      // Split deliberately. The foreign key is the authority on the place *existing*,
      // including a concurrent delete a pre-read would miss; `placeIsOnThisBurn` above
      // decides the pairing, which the key cannot see. That check cannot go stale in
      // the direction that matters — no route moves a place between burns, since
      // `placeUpdateSchema` omits `event_id`.
      //
      // The thread goes in with it (#375), so nothing later has to decide whether a
      // dream has one. Both or neither: a dream whose conversation failed to be created
      // would be a card the feed cannot draw.
      let threadId: string
      try {
        threadId = db.transaction((tx) => {
          tx.insert(session)
            .values({
              ...fields,
              id: row.id,
              event_id: open.id,
              facilitator_attendance_id: spot.attendanceId ?? null,
            })
            .run()

          return threadIdFor(tx, { type: 'session', id: row.id, event_id: open.id, title: row.title })
        })
      } catch (failure) {
        if (isForeignKeyViolation(failure)) return sendError(reply, 400)
        throw failure
      }

      await addEntry(
        db,
        {
          thread_id: threadId,
          kind: 'offered',
          author_account_id: viewer.account_id,
          body: 'offered this dream',
        },
        now(),
      )

      // After the write, and never to the person who just offered it (#259). Off
      // unless somebody asked for it, so on most installations this reaches nobody.
      //
      // `tellAttendees` rather than `notifyAttendees`: the entry above is what the feed
      // reads, and a line beside it would put one offer on the page twice.
      await tellAttendees(
        db,
        notify,
        open.id,
        {
          category: 'dream_offered',
          body: `${await displayName(db, viewer.account_id)} offered a dream: ${row.title}`,
          link: dreamPage(open.id, row.id),
        },
        { except: [viewer.account_id] },
      )

      // Built from what was written rather than read back: a new dream has nobody
      // helping and no hearts by definition.
      const dream: Session = {
        ...row,
        thread_id: threadId,
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
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(sessionUpdateSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const [existing] = await dreamRows(db, eq(session.id, request.params.id)).limit(1)

      // Scoped to a burn that has not ended, like every other member-facing write:
      // a dream from a finished burn is history, and an id noted while it was
      // current should not still be a way to rewrite it. Not the *active* burn —
      // the selector offers every burn still to come, and a dream can be offered
      // for the one after next.
      const open = existing === undefined ? undefined : await openEventNow(db, now, existing.event_id)
      if (existing === undefined || open === undefined) {
        return sendError(reply, 404)
      }

      const mine = await mineAt(request, existing.event_id)

      if (Object.keys(body).length === 0) {
        return { session: await oneDream(db, existing, mine) } satisfies SessionResponse
      }

      // The rule applied to the row as it would be, because a body carrying one
      // end of the slot cannot be judged on its own — `hasValidTimeSlot` is the
      // same check the schema makes when both ends are present. Not composed
      // into the WHERE: these are ISO instants, and comparing them as SQL
      // strings is wrong when the ends differ in fractional-second precision.
      if (!hasValidTimeSlot({ ...existing, ...body })) {
        return sendError(reply, 400)
      }

      if (!(await placeIsOnThisBurn(db, existing.event_id, body.place_id))) {
        return sendError(reply, 400)
      }
      const spot = await facilitatorSpot(db, existing.event_id, body.facilitator_account_id)
      if (!spot.ok) return sendError(reply, 400)

      // Last of the refusals and immediately before the write: a malformed body is
      // still a 400, and nothing between here and the UPDATE can change the pool.
      if (await refuseIfStale(request, reply, () => dreamsOf(existing.event_id, mine))) return reply

      const { facilitator_account_id: _wanted, ...fields } = body
      const patch =
        spot.attendanceId === undefined ? fields : { ...fields, facilitator_attendance_id: spot.attendanceId }

      try {
        await db.update(session).set(patch).where(eq(session.id, request.params.id))
      } catch (failure) {
        if (isForeignKeyViolation(failure)) return sendError(reply, 400)
        throw failure
      }

      // Read back rather than returned from the UPDATE: the facilitator leaves this
      // route as an account id and is stored as an attendance, and one query knowing
      // that mapping is better than two.
      const [row] = await dreamRows(db, eq(session.id, request.params.id)).limit(1)

      // After the 404, not before: a concurrent withdrawal between the pre-read and
      // the UPDATE would otherwise announce a change to a dream that no longer exists.
      if (row === undefined) return sendError(reply, 404)

      const by = (await viewerFor(request, { db, sessions }))?.account_id

      await dreamEdited(existing, body, row, by)
      await facilitatorMoved(by, existing, body.facilitator_account_id)

      return await withCollectionVersion(
        reply,
        { session: await oneDream(db, row, mine) } satisfies SessionResponse,
        () => dreamsOf(existing.event_id, mine),
      )
    },
  )

  app.delete<{ Params: { id: string } }>(
    apiRoutes.withdrawSession.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const [existing] = await db
        .select({ event_id: session.event_id, title: session.title })
        .from(session)
        .where(eq(session.id, request.params.id))
        .limit(1)

      if (existing === undefined) return sendError(reply, 404)

      const open = await openEventNow(db, now, existing.event_id)
      if (open === undefined) return sendError(reply, 404)

      const deleted = await db
        .delete(session)
        .where(and(eq(session.id, request.params.id), eq(session.event_id, open.id)))
        .returning({ id: session.id })

      if (deleted.length === 0) return sendError(reply, 404)

      // The thread stays: it holds no foreign key to the dream precisely so that
      // withdrawing one says so rather than deleting what people said about it (#375).
      const viewer = await viewerFor(request, { db, sessions })

      await noteOnDream(
        { id: request.params.id, event_id: open.id, title: existing.title },
        'withdrawn',
        viewer?.account_id,
        'withdrew this dream',
      )

      return reply.code(204).send()
    },
  )

  /**
   * The dream on a burn still open, and whatever place the caller has at it — which
   * may be none: somebody organising a burn they are not coming to is coherent, and
   * appointing people is part of that job (#350).
   */
  const onOpenBurn = async (
    request: FastifyRequest<{ Params: { id: string } }>,
  ): Promise<Refusal | Arranging> => {
    const [dream] = await dreamRows(db, eq(session.id, request.params.id)).limit(1)
    if (dream === undefined) return { code: 404, error: 'not_found' }

    const open = await openEventNow(db, now, dream.event_id)
    if (open === undefined) return { code: 404, error: 'not_found' }

    const viewer = await viewerFor(request, { db, sessions })
    const mine = viewer === undefined ? undefined : await attendanceFor(db, dream.event_id, viewer.account_id)

    return { dream, mine, callerId: viewer?.account_id }
  }

  /**
   * The same, for the writes keyed by the caller's own attendance rather than by
   * somebody they name — which today is the heart.
   *
   * A caller who is not coming to that burn is a **400**, not a 403: they may well
   * be a member in good standing, and what is wrong is the pairing.
   */
  const asAttendee = async (
    request: FastifyRequest<{ Params: { id: string } }>,
  ): Promise<Refusal | Attending> => {
    const found = await onOpenBurn(request)
    if ('code' in found) return found

    const mine = found.mine
    if (mine === undefined) return { code: 400, error: 'bad_request' }

    return { ...found, mine }
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
   * Whoever is **named** has to be coming to the burn — a dream is run by people who
   * are there. The caller does not (#350): arranging a burn is a job somebody can hold
   * without attending it, and the lead-roles register has always worked that way.
   */
  app.post<{ Params: { id: string } }>(
    apiRoutes.helpWithSession.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const body = bodyOf(helperSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const found = await onOpenBurn(request)
      if ('code' in found) return reply.code(found.code).send(errorResponse(found.error))

      const theirs = await attendanceFor(db, found.dream.event_id, body.account_id)
      if (theirs === undefined) return sendError(reply, 400)

      const added = await db
        .insert(sessionHelper)
        .values({ session_id: found.dream.id, attendance_id: theirs })
        .onConflictDoNothing()
        .returning()

      // Only when a row actually went in, like the removal below: a second tab, or a
      // repeated 👉, would otherwise push the same person the same line twice.
      if (added.length > 0) {
        await tell(found.callerId, body.account_id, `You are helping with ${found.dream.title}`)
        await noteOnDream(
          found.dream,
          'helper',
          found.callerId,
          body.account_id === found.callerId
            ? 'put a hand up to help'
            : `asked ${await displayName(db, body.account_id)} to help`,
        )
      }

      return { session: await oneDream(db, found.dream, found.mine) } satisfies SessionResponse
    },
  )

  app.delete<{ Params: { id: string; accountId: string } }>(
    apiRoutes.stopHelpingWithSession.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const found = await onOpenBurn(request)
      if ('code' in found) return reply.code(found.code).send(errorResponse(found.error))

      const theirs = await attendanceFor(db, found.dream.event_id, request.params.accountId)
      if (theirs === undefined) return sendError(reply, 400)

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
        await noteOnDream(
          found.dream,
          'helper',
          found.callerId,
          request.params.accountId === found.callerId
            ? 'cannot help after all'
            : `took ${await displayName(db, request.params.accountId)} off helping`,
        )
      }

      return { session: await oneDream(db, found.dream, found.mine) } satisfies SessionResponse
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
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const found = await asAttendee(request)
      if ('code' in found) return reply.code(found.code).send(errorResponse(found.error))

      await db
        .insert(sessionSupport)
        .values({ session_id: found.dream.id, attendance_id: found.mine })
        .onConflictDoNothing()

      return { session: await oneDream(db, found.dream, found.mine) } satisfies SessionResponse
    },
  )

  app.delete<{ Params: { id: string } }>(
    apiRoutes.withdrawSupportForSession.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const found = await asAttendee(request)
      if ('code' in found) return reply.code(found.code).send(errorResponse(found.error))

      await db
        .delete(sessionSupport)
        .where(
          and(eq(sessionSupport.session_id, found.dream.id), eq(sessionSupport.attendance_id, found.mine)),
        )

      return { session: await oneDream(db, found.dream, found.mine) } satisfies SessionResponse
    },
  )
}
