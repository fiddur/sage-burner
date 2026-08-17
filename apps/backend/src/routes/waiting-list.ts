import type { NotificationCategory } from '@sage-burner/shared'

import { membersPage, placesIn, withPlaces } from '@sage-burner/shared'
import { and, eq } from 'drizzle-orm'

import type { Database } from '../db/index.ts'
import type { Notifier, Told } from '../push/notify.ts'

import { attendance, event, notification } from '../db/schema.ts'
import { oneBatch } from '../push/notify.ts'
import { todayIso } from './events.ts'

const NEARLY_FULL = 4

const toldAlready = async (
  db: Database,
  { category, link, body }: { category: NotificationCategory; link: string; body: string },
): Promise<Set<string>> => {
  const rows = await db
    .selectDistinct({ account_id: notification.account_id })
    .from(notification)
    .where(and(eq(notification.category, category), eq(notification.link, link), eq(notification.body, body)))

  return new Set(rows.map((row) => row.account_id))
}

const tellTheUnpaid = async (
  db: Database,
  notify: Notifier,
  unpaid: readonly { account_id: string }[],
  told: Told & { link: string },
): Promise<void> => {
  const already = await toldAlready(db, { category: told.category, link: told.link, body: told.body })
  const one = oneBatch(told)

  for (const row of unpaid.filter((who) => !already.has(who.account_id))) {
    await notify(row.account_id, one)
  }
}

export const tellAboutTheWaitingList = async (
  db: Database,
  eventId: string,
  notify: Notifier,
  now: () => Date,
): Promise<void> => {
  const [burn] = await db
    .select({ name: event.name, member_cap: event.member_cap, end_date: event.end_date })
    .from(event)
    .where(eq(event.id, eventId))
    .limit(1)

  if (burn === undefined) return
  if (burn.end_date < todayIso(now)) return

  const rows = await db
    .select({
      account_id: attendance.account_id,
      payment_status: attendance.payment_status,
      joined_at: attendance.joined_at,
    })
    .from(attendance)
    .where(eq(attendance.event_id, eventId))

  const { left } = placesIn(rows, burn.member_cap)
  const unpaid = withPlaces(rows, burn.member_cap).filter((row) => row.payment_status !== 'paid')
  const link = membersPage(eventId)

  if (left > NEARLY_FULL) return

  if (left > 0) {
    await tellTheUnpaid(db, notify, unpaid, {
      category: 'waiting_list_near',
      body:
        left === 1
          ? `${burn.name} has 1 place left, and it goes to whoever pays. Your payment is not recorded yet.`
          : `${burn.name} has ${left} places left, and they go to whoever pays. Your payment is not recorded yet.`,
      link,
    })

    return
  }

  await tellTheUnpaid(
    db,
    notify,
    unpaid.filter((row) => !row.waiting),
    {
      category: 'waiting_list_near',
      body: `${burn.name} is full, and a place goes to whoever pays for it. You are in one for now — your payment is not recorded yet.`,
      link,
    },
  )

  await tellTheUnpaid(
    db,
    notify,
    unpaid.filter((row) => row.waiting),
    {
      category: 'waiting_list_pushed',
      body: `${burn.name} is full and you are on the waiting list. A place goes to whoever pays for it.`,
      link,
    },
  )
}
