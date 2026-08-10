import { and, asc, eq, inArray } from 'drizzle-orm'

import type { Database } from '../db/index.ts'

import { attendanceHelping, eventOption } from '../db/schema.ts'

export const helpingFor = async (db: Database, attendanceIds: readonly string[]) => {
  if (attendanceIds.length === 0) return new Map<string, string[]>()

  const rows = await db
    .select()
    .from(attendanceHelping)
    .where(inArray(attendanceHelping.attendance_id, [...attendanceIds]))

  const byStay = new Map<string, string[]>()
  for (const row of rows) {
    byStay.set(row.attendance_id, [...(byStay.get(row.attendance_id) ?? []), row.option_id])
  }

  return byStay
}

export const helpingIdsFor = async (db: Database, attendanceId: string) =>
  (await helpingFor(db, [attendanceId])).get(attendanceId) ?? []

export const areHelpingOptions = async (
  db: Database,
  eventId: string,
  optionIds: readonly string[],
): Promise<boolean> => {
  const wanted = [...new Set(optionIds)]
  if (wanted.length === 0) return true

  const real = await db
    .select({ id: eventOption.id })
    .from(eventOption)
    .where(and(eq(eventOption.event_id, eventId), eq(eventOption.kind, 'helping')))

  const allowed = new Set(real.map((row) => row.id))

  return wanted.every((id) => allowed.has(id))
}

type Writer = Pick<Database, 'delete' | 'insert'>

export const writeHelping = (writer: Writer, attendanceId: string, optionIds: readonly string[]): void => {
  writer.delete(attendanceHelping).where(eq(attendanceHelping.attendance_id, attendanceId)).run()

  for (const option_id of new Set(optionIds)) {
    writer.insert(attendanceHelping).values({ attendance_id: attendanceId, option_id }).run()
  }
}

export const helpingLabelsFor = async (db: Database, attendanceIds: readonly string[]) => {
  if (attendanceIds.length === 0) return new Map<string, { id: string; label: string }[]>()

  const rows = await db
    .select({
      attendance_id: attendanceHelping.attendance_id,
      id: eventOption.id,
      label: eventOption.label,
      order: eventOption.order,
    })
    .from(attendanceHelping)
    .innerJoin(eventOption, eq(eventOption.id, attendanceHelping.option_id))
    .where(inArray(attendanceHelping.attendance_id, [...attendanceIds]))
    .orderBy(asc(eventOption.order), asc(eventOption.id))

  const byStay = new Map<string, { id: string; label: string }[]>()
  for (const row of rows) {
    byStay.set(row.attendance_id, [
      ...(byStay.get(row.attendance_id) ?? []),
      { id: row.id, label: row.label },
    ])
  }

  return byStay
}
