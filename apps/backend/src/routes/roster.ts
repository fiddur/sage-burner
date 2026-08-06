import type {
  MemberRosterEntry,
  MemberRosterResponse,
  RosterEntry,
  RosterResponse,
} from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { apiRoutes, errorResponse, paymentUpdateSchema, withPlaces } from '@sage-burner/shared'
import { and, eq } from 'drizzle-orm'

import type { GuardDeps } from '../auth/guards.ts'

import { createGuards } from '../auth/guards.ts'
import { account, attendance, event, eventOption } from '../db/schema.ts'
import { noStore } from '../http.ts'
import { activeEvent, todayIso } from './events.ts'
import { helpingIdsFor, helpingLabelsFor } from './helping.ts'

export interface RosterDeps extends GuardDeps {
  now?: () => Date
}

/**
 * What a member is shown of somebody else's stay.
 *
 * Written out field by field rather than spread-and-delete, and that is the whole
 * safety property: this is an object literal against `MemberRosterEntry`, so a
 * column added to the organiser's row reaches members only when somebody names it
 * here, and one removed from the member schema stops compiling instead of quietly
 * still being sent.
 */
const asMemberEntry = (entry: RosterEntry): MemberRosterEntry => ({
  id: entry.id,
  event_id: entry.event_id,
  account_id: entry.account_id,
  joined_at: entry.joined_at,
  arrival_date: entry.arrival_date,
  departure_date: entry.departure_date,
  lodging_option_id: entry.lodging_option_id,
  lodging: entry.lodging,
  helping_option_ids: entry.helping_option_ids,
  helping: entry.helping,
  helping_other: entry.helping_other,
  notes: entry.notes,
  name: entry.name,
  contact: entry.contact,
  allergies_notes: entry.allergies_notes,
  payment_status: entry.payment_status,
  waiting: entry.waiting,
})

/**
 * Who is coming to a burn, and recording that they have paid.
 *
 * The direct replacement for the spreadsheet's Members tab. Person-level fields
 * are joined in from `account` rather than copied, so an allergy corrected on
 * someone's own profile page is corrected here in the same moment — which is the
 * point of the account/attendance split.
 *
 * Two readers, one query. The organiser's is under `/api/admin/` and carries
 * payment; the member's is `/api/events/…/members`, outside that prefix rather than
 * exempted inside it (#159, and #64 for why). They share `rosterFor` so the order —
 * which decides who actually has a place — cannot come out differently on the two
 * pages, and differ only by `asMemberEntry`.
 */
export const registerRosterRoutes = (
  app: FastifyInstance,
  { db, sessions, now = () => new Date() }: RosterDeps,
) => {
  const { requireApproved } = createGuards({ db, sessions })

  app.get<{ Params: { eventId: string } }>(apiRoutes.adminRoster.fastify, async (request, reply) => {
    void noStore(reply)

    const { eventId } = request.params
    const found = await eventFor(eventId)
    if (found === undefined) return reply.code(404).send(errorResponse('not_found'))

    return {
      event: { id: found.id, name: found.name, member_cap: found.member_cap },
      entries: await rosterFor(eventId, found.member_cap),
    } satisfies RosterResponse
  })

  app.get(apiRoutes.getActiveRoster.fastify, async (_request, reply) => {
    void noStore(reply)

    const open = await activeEvent(db, todayIso(now))
    if (open === undefined) return { event: null, entries: [] } satisfies RosterResponse

    const summary = { id: open.id, name: open.name, member_cap: open.member_cap }

    return { event: summary, entries: await rosterFor(open.id, open.member_cap) } satisfies RosterResponse
  })

  app.get<{ Params: { eventId: string } }>(
    apiRoutes.getMembers.fastify,
    { preHandler: requireApproved },
    async (request, reply) => {
      void noStore(reply)

      const { eventId } = request.params
      const found = await eventFor(eventId)
      if (found === undefined) return reply.code(404).send(errorResponse('not_found'))

      return {
        event: found,
        entries: (await rosterFor(eventId, found.member_cap)).map(asMemberEntry),
      } satisfies MemberRosterResponse
    },
  )

  app.patch<{ Params: { eventId: string; accountId: string } }>(
    apiRoutes.setPayment.fastify,
    async (request, reply) => {
      void noStore(reply)

      const { eventId, accountId } = request.params
      const parsed = paymentUpdateSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send(errorResponse('bad_request'))

      if (Object.keys(parsed.data).length === 0) {
        const [row] = await db
          .select()
          .from(attendance)
          .where(and(eq(attendance.event_id, eventId), eq(attendance.account_id, accountId)))
          .limit(1)

        return row === undefined
          ? reply.code(404).send(errorResponse('not_found'))
          : { attendance: await withHelping(row) }
      }

      const [updated] = await db
        .update(attendance)
        .set({
          payment_status: parsed.data.payment_status,
          // Cleared on unmarking, in the same statement that unmarks — so a date
          // cannot outlive the payment it recorded.
          payment_date: parsed.data.payment_status === 'paid' ? todayIso(now) : null,
        })
        .where(and(eq(attendance.event_id, eventId), eq(attendance.account_id, accountId)))
        .returning()

      return updated === undefined
        ? reply.code(404).send(errorResponse('not_found'))
        : { attendance: await withHelping(updated) }
    },
  )

  /**
   * The ticks travel with the row here too.
   *
   * Nothing reads them off a payment response today, but `Attendance` says every
   * one of these carries them, and a route quietly answering a different shape is
   * how that stops being true.
   */
  async function withHelping(row: typeof attendance.$inferSelect) {
    return { ...row, helping_option_ids: await helpingIdsFor(db, row.id) }
  }

  async function eventFor(eventId: string) {
    const [row] = await db
      .select({
        id: event.id,
        name: event.name,
        member_cap: event.member_cap,
        payment_info_markdown: event.payment_info_markdown,
      })
      .from(event)
      .where(eq(event.id, eventId))
      .limit(1)

    return row
  }

  async function rosterFor(eventId: string, cap: number) {
    const rows = await db
      .select({
        id: attendance.id,
        event_id: attendance.event_id,
        account_id: attendance.account_id,
        joined_at: attendance.joined_at,
        arrival_date: attendance.arrival_date,
        departure_date: attendance.departure_date,
        lodging_option_id: attendance.lodging_option_id,
        lodging: eventOption.label,
        helping_other: attendance.helping_other,
        notes: attendance.notes,
        payment_status: attendance.payment_status,
        payment_date: attendance.payment_date,
        email: account.email,
        name: account.name,
        contact: account.contact,
        allergies_notes: account.allergies_notes,
      })
      .from(attendance)
      .innerJoin(account, eq(account.id, attendance.account_id))
      // Left, so someone who has not said where they are sleeping is still on
      // the roster. An inner join would quietly shorten the list an organiser
      // counts heads from.
      .leftJoin(eventOption, eq(eventOption.id, attendance.lodging_option_id))
      .where(eq(attendance.event_id, eventId))

    // One query for the whole page's ticks rather than one per row.
    const helping = await helpingLabelsFor(
      db,
      rows.map((row) => row.id),
    )

    // Ordered and cut by the shared rule rather than here, so #79's member-facing
    // list gives the same answer when it arrives.
    return withPlaces(
      rows.map((row) => {
        const ticked = helping.get(row.id) ?? []

        return {
          ...row,
          helping_option_ids: ticked.map((entry) => entry.id),
          helping: ticked.length === 0 ? null : ticked.map((entry) => entry.label).join(', '),
        }
      }),
      cap,
    )
  }
}
