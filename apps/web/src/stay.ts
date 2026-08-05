import type { Attendance, AttendanceUpdate } from '@sage-burner/shared'

/**
 * The stay details as a form holds them: every field a string or a list, never null.
 *
 * A form's empty is `''` and an attendance's empty is `null`, and the two conversions
 * are the whole of what used to sit inline in `StayForm`. They are here because a
 * second form now asks the same questions — the invite page, where somebody sets up
 * their first burn before they have a page to come back to (#224).
 */
export interface StayDraft {
  arrival_date: string
  departure_date: string
  lodging_option_id: string
  helping_option_ids: readonly string[]
  helping_other: string
  notes: string
}

/** What a burn's dates make the obvious starting answer: the whole of it. */
export const stayForBurn = (start: string, end: string): StayDraft => ({
  arrival_date: start,
  departure_date: end,
  lodging_option_id: '',
  helping_option_ids: [],
  helping_other: '',
  notes: '',
})

/** An existing stay, as the form holds it. */
export const stayFromAttendance = (attendance: Attendance): StayDraft => ({
  arrival_date: attendance.arrival_date ?? '',
  departure_date: attendance.departure_date ?? '',
  lodging_option_id: attendance.lodging_option_id ?? '',
  helping_option_ids: attendance.helping_option_ids,
  helping_other: attendance.helping_other ?? '',
  notes: attendance.notes ?? '',
})

const blankToNull = (value: string) => (value.trim() === '' ? null : value.trim())

/** The draft as the API takes it, with the form's empties turned back into nulls. */
export const stayUpdate = (draft: StayDraft): AttendanceUpdate => ({
  arrival_date: blankToNull(draft.arrival_date),
  departure_date: blankToNull(draft.departure_date),
  lodging_option_id: draft.lodging_option_id === '' ? null : draft.lodging_option_id,
  helping_option_ids: [...draft.helping_option_ids],
  helping_other: blankToNull(draft.helping_other),
  notes: blankToNull(draft.notes),
})

/**
 * What is wrong with the draft, in words, or nothing.
 *
 * Checked here as well as server-side so the message names the problem rather than
 * arriving as a bare 400. Only the pair matters: either date may be missing, and a
 * comparison against a missing one is not a comparison.
 */
export const stayProblem = (draft: StayDraft): string | undefined =>
  draft.arrival_date !== '' && draft.departure_date !== '' && draft.departure_date < draft.arrival_date
    ? 'Your departure is before your arrival.'
    : undefined
