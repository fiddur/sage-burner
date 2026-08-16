import type {
  AttendanceResponse,
  MemberRosterEntry,
  MemberRosterResponse,
  RosterEntry,
  RosterResponse,
} from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { apiRoutes, paymentUpdateSchema, withPlaces } from '@sage-burner/shared'
import { eq } from 'drizzle-orm'

import type { GuardDeps } from '../auth/guards.ts'
import type { Notifier } from '../push/notify.ts'

import { createGuards } from '../auth/guards.ts'
import { viewerFor } from '../auth/viewer.ts'
import { allOf } from '../db/conditions.ts'
import { isEmptyPatch, patchRow } from '../db/patch.ts'
import { account, accountAvatar, attendance, event, eventOption } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { allergyLabelsFor } from './allergy-ticks.ts'
import { activeEventNow, todayIso } from './events.ts'
import { helpingIdsFor, helpingLabelsFor } from './helping.ts'
import { tellAboutTheWaitingList } from './waiting-list.ts'

export interface RosterDeps extends GuardDeps {
  now: () => Date
  notify?: Notifier
}

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
  avatar: entry.avatar,
  contact: entry.contact,
  allergies_notes: entry.allergies_notes,
  allergy_items: entry.allergy_items,
  payment_status: entry.payment_status,
  waiting: entry.waiting,
})

export const registerRosterRoutes = (
  app: FastifyInstance,
  { db, sessions, now, notify = async () => undefined }: RosterDeps,
) => {
  const { requireApproved } = createGuards({ db, sessions })

  app.get<{ Params: { eventId: string } }>(apiRoutes.adminRoster.fastify, async (request, reply) => {
    void noStore(reply)

    const { eventId } = request.params
    const found = await eventFor(eventId)
    if (found === undefined) return sendError(reply, 404)

    return {
      event: { id: found.id, name: found.name, member_cap: found.member_cap },
      entries: await rosterFor(eventId, found.member_cap),
    } satisfies RosterResponse
  })

  app.get(apiRoutes.getActiveRoster.fastify, async (_request, reply) => {
    void noStore(reply)

    const open = await activeEventNow(db, now)
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
      if (found === undefined) return sendError(reply, 404)

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
      const body = bodyOf(paymentUpdateSchema, request)
      if (body === undefined) return sendError(reply, 400)

      const theirs = allOf(eq(attendance.event_id, eventId), eq(attendance.account_id, accountId))

      const [before] = await db
        .select({ payment_status: attendance.payment_status })
        .from(attendance)
        .where(theirs)
        .limit(1)

      const patched = await patchRow(
        db,
        attendance,
        theirs,
        isEmptyPatch(body)
          ? {}
          : {
              payment_status: body.payment_status,
              payment_date: body.payment_status === 'paid' ? todayIso(now) : null,
            },
      )

      if (patched.kind !== 'ok') return sendError(reply, 404)
      const updated = patched.row

      const nowPaid = updated.payment_status === 'paid'
      const wasPaid = before?.payment_status === 'paid'

      if (nowPaid && !wasPaid) {
        const actor = (await viewerFor(request, { db, sessions }))?.account_id
        if (actor !== accountId) {
          await notify(accountId, {
            category: 'payment',
            body: 'Your payment has been recorded.',
            link: '/members',
          })
        }
      }

      if (nowPaid !== wasPaid) await tellAboutTheWaitingList(db, eventId, notify, now)

      return { attendance: await withHelping(updated) } satisfies AttendanceResponse
    },
  )

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
        transfer_info_markdown: event.transfer_info_markdown,
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
        avatar: accountAvatar.updated_at,
        contact: account.contact,
        allergies_notes: account.allergies_notes,
      })
      .from(attendance)
      .innerJoin(account, eq(account.id, attendance.account_id))
      .leftJoin(accountAvatar, eq(accountAvatar.account_id, account.id))
      .leftJoin(eventOption, eq(eventOption.id, attendance.lodging_option_id))
      .where(eq(attendance.event_id, eventId))

    const helping = await helpingLabelsFor(
      db,
      rows.map((row) => row.id),
    )

    const allergies = await allergyLabelsFor(
      db,
      rows.map((row) => row.account_id),
    )

    return withPlaces(
      rows.map((row) => {
        const ticked = helping.get(row.id) ?? []

        return {
          ...row,
          allergy_items: allergies.get(row.account_id) ?? [],
          helping_option_ids: ticked.map((entry) => entry.id),
          helping: ticked.length === 0 ? null : ticked.map((entry) => entry.label).join(', '),
        }
      }),
      cap,
    )
  }
}
