import { and, asc, eq, inArray } from 'drizzle-orm'

import type { Database } from '../db/index.ts'

import { isForeignKeyViolation } from '../db/errors.ts'
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
 * Whether every id is a `helping` option of this burn.
 *
 * Separate from writing them, and called before anything else is written: the
 * form sends the ticks and the columns in one PATCH, so rejecting them after the
 * column update would answer 400 with the rest already committed.
 *
 * The checkboxes cannot offer another burn's list or a bed, but the API takes
 * what it is sent.
 */
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

/**
 * Replace one stay's ticks with exactly these options.
 *
 * Delete-then-insert rather than a diff: at a handful of rows the diff is more
 * code than it saves, and the result is the same set either way. Validity is
 * `areHelpingOptions`' job, and the caller's to ask before writing anything.
 */
export const setHelping = (
  db: Database,
  attendanceId: string,
  optionIds: readonly string[],
): 'ok' | 'gone' => {
  const wanted = [...new Set(optionIds)]

  try {
    db.transaction((tx) => {
      tx.delete(attendanceHelping).where(eq(attendanceHelping.attendance_id, attendanceId)).run()
      for (const option_id of wanted) {
        tx.insert(attendanceHelping).values({ attendance_id: attendanceId, option_id }).run()
      }
    })
  } catch (failure) {
    // The option was removed between `areHelpingOptions` and here — an organiser
    // deleting a chore in the same breath as a member ticking it. Not defended
    // against, but answered rather than thrown, so it matches what the lodging
    // path gives for the same class of thing.
    //
    // Not reachable under test: `inject` serialises requests, so nothing can
    // delete the row in that gap. `isForeignKeyViolation` is pinned against a
    // real violation elsewhere, which is what keeps the message it matches from
    // drifting unnoticed.
    if (isForeignKeyViolation(failure)) return 'gone'
    throw failure
  }

  return 'ok'
}

/**
 * The same ticks, with the labels the organiser gave them.
 *
 * The roster and its CSV are read by a person; a column of UUIDs is not.
 */
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
