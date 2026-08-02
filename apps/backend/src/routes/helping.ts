import { and, eq, inArray } from 'drizzle-orm'

import type { Database } from '../db/index.ts'

import { attendanceHelping, eventOption } from '../db/schema.ts'

/**
 * The helping-out ticks for a set of stays, as ids per stay.
 *
 * One query for all of them rather than one each: the caller usually has a whole
 * roster in hand, and a loop of selects would be the slower, longer way to say
 * the same thing.
 */
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

/** The ids for one stay, which is the common case at the member's own routes. */
export const helpingIdsFor = async (db: Database, attendanceId: string) =>
  (await helpingFor(db, [attendanceId])).get(attendanceId) ?? []

/**
 * Replace one stay's ticks with exactly these options.
 *
 * Delete-then-insert rather than a diff: at a handful of rows the diff is more
 * code than it saves, and the result is the same set either way.
 *
 * Every id must be a `helping` option of this burn. Anything else is refused —
 * the checkboxes cannot offer another burn's list, but the API takes what it is
 * sent.
 */
export const setHelping = async (
  db: Database,
  attendanceId: string,
  eventId: string,
  optionIds: readonly string[],
): Promise<'ok' | 'invalid'> => {
  const wanted = [...new Set(optionIds)]

  if (wanted.length > 0) {
    const real = await db
      .select({ id: eventOption.id })
      .from(eventOption)
      .where(and(eq(eventOption.event_id, eventId), eq(eventOption.kind, 'helping')))

    const allowed = new Set(real.map((row) => row.id))
    if (wanted.some((id) => !allowed.has(id))) return 'invalid'
  }

  db.transaction((tx) => {
    tx.delete(attendanceHelping).where(eq(attendanceHelping.attendance_id, attendanceId)).run()
    for (const option_id of wanted) {
      tx.insert(attendanceHelping).values({ attendance_id: attendanceId, option_id }).run()
    }
  })

  return 'ok'
}
