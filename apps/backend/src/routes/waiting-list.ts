import { eq } from 'drizzle-orm'

import type { Database } from '../db/index.ts'
import type { Notifier } from '../push/notify.ts'

import { attendance, event } from '../db/schema.ts'

const NEARLY_FULL = 4

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

  if (paid > burn.member_cap) return

  if (paid === burn.member_cap) {
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
