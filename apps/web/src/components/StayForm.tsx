import type { Attendance, EventOption } from '@sage-burner/shared'

import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { stayFromAttendance, stayProblem, stayUpdate } from '../stay.ts'
import { FormError, useFormError } from './FormError.tsx'
import { PendingButton } from './PendingButton.tsx'
import { StayFields } from './StayFields.tsx'

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
  eventId: string
  attendance: Attendance
  lodgingOptions?: readonly EventOption[]
  helpingOptions?: readonly EventOption[]
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
        signedInMember
      />

      {saved && (
        <p class="form-note" role="status">
          Saved.
        </p>
      )}

      <FormError error={error} />

      <PendingButton busy={saving} label="Save these details" busyLabel="Saving…" type="submit" />
    </form>
  )
}
