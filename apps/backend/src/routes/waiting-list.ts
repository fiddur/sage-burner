import { membersPage } from '@sage-burner/shared'
import { and, eq } from 'drizzle-orm'

import type { Database } from '../db/index.ts'
import type { Notifier } from '../push/notify.ts'

import { attendance, event, notification } from '../db/schema.ts'

const NEARLY_FULL = 4

const toldItIsFull = async (db: Database, link: string): Promise<Set<string>> => {
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
    .select({ account_id: attendance.account_id, payment_status: attendance.payment_status })
    .from(attendance)
    .where(eq(attendance.event_id, eventId))

  const unpaid = rows.filter((row) => row.payment_status !== 'paid')
  const left = burn.member_cap - (rows.length - unpaid.length)
  const link = membersPage(eventId)

  if (left <= 0) {
    const already = await toldItIsFull(db, link)

    for (const row of unpaid.filter((one) => !already.has(one.account_id))) {
      await notify(row.account_id, {
        category: 'waiting_list_pushed',
        body: `${burn.name} is full — every place is held by somebody who has paid. You are on the waiting list until one is handed over.`,
        link,
      })
    }

    return
  }

  if (left > NEARLY_FULL) return

  for (const row of unpaid) {
    await notify(row.account_id, {
      category: 'waiting_list_near',
      body: `${burn.name} has ${left} ${left === 1 ? 'place' : 'places'} left, and they go to whoever pays. Your payment is not recorded yet.`,
      link,
    })
  }
}
