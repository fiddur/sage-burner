import { eq } from 'drizzle-orm'

import type { Database } from '../db/index.ts'
import type { Notifier } from '../push/notify.ts'

import { attendance, event } from '../db/schema.ts'

/**
 * How close to full is close enough to warn somebody (#248).
 *
 * Four places, which is the sketch's number. Inside that window every genuine
 * payment does warn every unpaid member again — so on a cap of 42 somebody who has
 * not paid hears it as payments 38 through 41 land. That is a countdown rather than
 * a repeat, and it is the point: the number of places left is what changed. Outside
 * the window nothing is sent at all.
 */
const NEARLY_FULL = 4

/**
 * What one payment did to everybody who has not made one.
 *
 * These are the only notifications not caused by an action taken *against* the
 * person told: somebody else pays, the burn gets fuller, and an unpaid member's
 * standing changes without anybody touching their row. That is exactly why they are
 * worth sending — it is the one change nobody would otherwise see coming.
 *
 * Called after the payment is written, so the counts are what the payment made true.
 * Delivery failure is swallowed by the notifier, and this is deliberately not in the
 * same transaction as the payment: recording that somebody paid must not fail
 * because a bell could not be rung.
 */
export const tellAboutTheWaitingList = async (
  db: Database,
  eventId: string,
  notify: Notifier,
): Promise<void> => {
  const [burn] = await db
    .select({ name: event.name, member_cap: event.member_cap })
    .from(event)
    .where(eq(event.id, eventId))
    .limit(1)

  if (burn === undefined) return

  const rows = await db
    .select({ account_id: attendance.account_id, payment_status: attendance.payment_status })
    .from(attendance)
    .where(eq(attendance.event_id, eventId))

  const paid = rows.filter((row) => row.payment_status === 'paid').length
  const unpaid = rows.filter((row) => row.payment_status !== 'paid')

  // Full, or past it. Paid members come first, so an unpaid one is now behind the
  // line whatever order they joined in.
  if (paid >= burn.member_cap) {
    for (const row of unpaid) {
      await notify(row.account_id, {
        category: 'waiting_list_pushed',
        body: `${burn.name} is full. Paid members come first, so you are on the waiting list until somebody transfers a place.`,
        link: '/members',
      })
    }

    return
  }

  if (paid < burn.member_cap - NEARLY_FULL) return

  for (const row of unpaid) {
    await notify(row.account_id, {
      category: 'waiting_list_near',
      body: `${burn.name} has ${burn.member_cap - paid} places left and your payment is not recorded yet.`,
      link: '/members',
    })
  }
}
