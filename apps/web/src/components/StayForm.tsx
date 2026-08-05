import type { Attendance, EventOption } from '@sage-burner/shared'

import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { stayFromAttendance, stayProblem, stayUpdate } from '../stay.ts'
import { FormError, useFormError } from './FormError.tsx'
import { StayFields } from './StayFields.tsx'

/**
 * The details that belong to one burn rather than to the person.
 *
 * Payment is shown by the page around this and not editable here: it is the
 * organiser's to set, and a control a member could touch would be one that
 * always fails.
 */
export const StayForm = ({
  api,
  eventId,
  attendance,
  lodgingOptions = [],
  helpingOptions = [],
  taken = {},
  onSaved,
}: {
  api: Pick<ApiClient, 'updateMyStay'>
  /** Which burn this stay is at. The page shows more than one. */
  eventId: string
  attendance: Attendance
  /** This burn's lodging list, in the organiser's order. */
  lodgingOptions?: readonly EventOption[]
  /** This burn's helping-out list, in the organiser's order. */
  helpingOptions?: readonly EventOption[]
  /** How many have already picked each option, by option id. */
  taken?: Readonly<Record<string, number>>
  onSaved: (saved: Attendance) => void
}) => {
  const [draft, setDraft] = useState(() => stayFromAttendance(attendance))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useFormError()

  const save = async () => {
    setError(undefined)
    setSaved(false)

    const problem = stayProblem(draft)
    if (problem !== undefined) {
      setError(problem)
      return
    }

    setSaving(true)
    try {
      const { attendance: updated } = await api.updateMyStay(eventId, stayUpdate(draft))
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
      <StayFields
        draft={draft}
        onChange={setDraft}
        lodgingOptions={lodgingOptions}
        helpingOptions={helpingOptions}
        lodgingTaken={taken}
        heldLodging={attendance.lodging_option_id}
        offerListEditing
      />

      {saved && (
        <p class="form-note" role="status">
          Saved.
        </p>
      )}

      <FormError error={error} />

      <button type="submit" disabled={saving}>
        {saving ? 'Saving…' : 'Save these details'}
      </button>
    </form>
  )
}
