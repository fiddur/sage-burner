import { membersPage, withPlaces } from '@sage-burner/shared'
import { and, eq } from 'drizzle-orm'

import type { Database } from '../db/index.ts'
import type { Notifier } from '../push/notify.ts'

import { attendance, event, notification } from '../db/schema.ts'

const NEARLY_FULL = 4

const toldTheyAreWaiting = async (db: Database, link: string): Promise<Set<string>> => {
  const rows = await db
    .selectDistinct({ account_id: notification.account_id })
    .from(notification)
    .where(and(eq(notification.category, 'waiting_list_pushed'), eq(notification.link, link)))

  return new Set(rows.map((row) => row.account_id))
}

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
    .select({
      account_id: attendance.account_id,
      payment_status: attendance.payment_status,
      joined_at: attendance.joined_at,
    })
    .from(attendance)
    .where(eq(attendance.event_id, eventId))

  const link = membersPage(eventId)
  const placed = withPlaces(rows, burn.member_cap)
  const already = await toldTheyAreWaiting(db, link)

  const below = placed.filter(
    (one) => one.waiting && one.payment_status !== 'paid' && !already.has(one.account_id),
  )

  for (const row of below) {
    await notify(row.account_id, {
      category: 'waiting_list_pushed',
      body: `${burn.name} is full. Places go to paid members first and then in the order people joined, so you are on the waiting list until somebody hands theirs over.`,
      link,
    })
  }

  const paid = rows.filter((row) => row.payment_status === 'paid').length
  if (paid < burn.member_cap - NEARLY_FULL || paid >= burn.member_cap) return

  for (const row of placed.filter((one) => !one.waiting && one.payment_status !== 'paid')) {
    await notify(row.account_id, {
      category: 'waiting_list_near',
      body: `${burn.name} has ${burn.member_cap - paid} places left and your payment is not recorded yet.`,
      link,
    })
  }
}
