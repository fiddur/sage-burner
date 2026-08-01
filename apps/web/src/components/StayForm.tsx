import type { Attendance } from '@sage-burner/shared'

import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'

/**
 * The details that belong to one burn rather than to the person.
 *
 * Payment is shown by the page around this and not editable here: it is the
 * organiser's to set, and a control a member could touch would be one that
 * always fails.
 */
export const StayForm = ({
  api,
  attendance,
  onSaved,
}: {
  api: Pick<ApiClient, 'updateMyStay'>
  attendance: Attendance
  onSaved: (saved: Attendance) => void
}) => {
  const [arrival, setArrival] = useState(attendance.arrival_date ?? '')
  const [departure, setDeparture] = useState(attendance.departure_date ?? '')
  const [lodging, setLodging] = useState(attendance.lodging ?? '')
  const [shift, setShift] = useState(attendance.shift_preference ?? '')
  const [notes, setNotes] = useState(attendance.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const blankToNull = (value: string) => (value.trim() === '' ? null : value.trim())

  const save = async () => {
    setError(undefined)
    setSaved(false)
    // Checked here as well as server-side, so the message names the problem
    // rather than arriving as a bare 400.
    if (arrival !== '' && departure !== '' && departure < arrival) {
      setError('Your departure is before your arrival.')
      return
    }

    setSaving(true)
    try {
      const { attendance: updated } = await api.updateMyStay({
        arrival_date: blankToNull(arrival),
        departure_date: blankToNull(departure),
        lodging: blankToNull(lodging),
        shift_preference: blankToNull(shift),
        notes: blankToNull(notes),
      })
      onSaved(updated)
      setSaved(true)
    } catch (failure) {
      setError(
        isApiError(failure) && failure.status === 400
          ? 'Those dates do not work together. Check the arrival and departure.'
          : 'Could not save that. Please try again.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      class="form"
      onSubmit={(submitEvent) => {
        submitEvent.preventDefault()
        void save()
      }}
    >
      {error !== undefined && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}

      <label class="field">
        <span>Arriving</span>
        <input
          type="date"
          name="arrival_date"
          // Bound to its partner so the picker cannot offer an inverted range at
          // all. The server still refuses one — a `max` is a hint a keyboard can
          // walk straight past — but this is the difference between being told
          // afterwards and never being able to say it.
          max={departure === '' ? undefined : departure}
          value={arrival}
          onInput={(inputEvent) => setArrival(inputEvent.currentTarget.value)}
        />
      </label>

      <label class="field">
        <span>Leaving</span>
        <input
          type="date"
          name="departure_date"
          min={arrival === '' ? undefined : arrival}
          value={departure}
          onInput={(inputEvent) => setDeparture(inputEvent.currentTarget.value)}
        />
      </label>

      <label class="field">
        <span>Where are you sleeping?</span>
        <input
          type="text"
          name="lodging"
          maxLength={200}
          value={lodging}
          onInput={(inputEvent) => setLodging(inputEvent.currentTarget.value)}
        />
      </label>

      <label class="field">
        <span>What would you rather help with?</span>
        <input
          type="text"
          name="shift_preference"
          maxLength={200}
          value={shift}
          onInput={(inputEvent) => setShift(inputEvent.currentTarget.value)}
        />
      </label>

      <label class="field">
        <span>Anything else we should know?</span>
        <textarea
          name="notes"
          maxLength={2000}
          value={notes}
          onInput={(inputEvent) => setNotes(inputEvent.currentTarget.value)}
        />
      </label>

      {saved && (
        <p class="form-note" role="status">
          Saved.
        </p>
      )}

      <button type="submit" disabled={saving}>
        {saving ? 'Saving…' : 'Save these details'}
      </button>
    </form>
  )
}
