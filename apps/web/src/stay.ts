import type { Attendance, AttendanceUpdate } from '@sage-burner/shared'

export interface StayDraft {
  arrival_date: string
  departure_date: string
  lodging_option_id: string
  helping_option_ids: readonly string[]
  helping_other: string
  notes: string
}

export const stayForBurn = (start: string, end: string): StayDraft => ({
  arrival_date: start,
  departure_date: end,
  lodging_option_id: '',
  helping_option_ids: [],
  helping_other: '',
  notes: '',
})

export const stayFromAttendance = (attendance: Attendance): StayDraft => ({
  arrival_date: attendance.arrival_date ?? '',
  departure_date: attendance.departure_date ?? '',
  lodging_option_id: attendance.lodging_option_id ?? '',
  helping_option_ids: attendance.helping_option_ids,
  helping_other: attendance.helping_other ?? '',
  notes: attendance.notes ?? '',
})

const blankToNull = (value: string) => (value.trim() === '' ? null : value.trim())

export const stayUpdate = (draft: StayDraft): AttendanceUpdate => ({
  arrival_date: blankToNull(draft.arrival_date),
  departure_date: blankToNull(draft.departure_date),
  lodging_option_id: draft.lodging_option_id === '' ? null : draft.lodging_option_id,
  helping_option_ids: [...draft.helping_option_ids],
  helping_other: blankToNull(draft.helping_other),
  notes: blankToNull(draft.notes),
})

export const stayProblem = (draft: StayDraft): string | undefined =>
  draft.arrival_date !== '' && draft.departure_date !== '' && draft.departure_date < draft.arrival_date
    ? 'Your departure is before your arrival.'
    : undefined
