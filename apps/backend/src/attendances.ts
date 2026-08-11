import { and, eq } from 'drizzle-orm'

import type { Database } from './db/index.ts'

import { attendance } from './db/schema.ts'

export const accountForAttendance = async (db: Database, attendanceId: string) => {
  const [row] = await db
    .select({ account_id: attendance.account_id })
    .from(attendance)
    .where(eq(attendance.id, attendanceId))
    .limit(1)

  return row?.account_id
}

export const attendanceFor = async (db: Database, eventId: string, accountId: string) => {
  const [row] = await db
    .select({ id: attendance.id })
    .from(attendance)
    .where(and(eq(attendance.event_id, eventId), eq(attendance.account_id, accountId)))
    .limit(1)

  return row?.id
}
