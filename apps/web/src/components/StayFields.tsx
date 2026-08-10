import type { EventOption } from '@sage-burner/shared'

import { MAX_NOTES, MAX_OPTION_LABEL } from '@sage-burner/shared'

import type { StayDraft } from '../stay.ts'

import { rowsFor } from '../textarea.ts'

export const StayFields = ({
  draft,
  onChange,
  lodgingOptions = [],
  helpingOptions = [],
  lodgingTaken = {},
  heldLodging,
  signedInMember = false,
}: {
  draft: StayDraft
  onChange: (next: StayDraft) => void
  lodgingOptions?: readonly EventOption[]
  helpingOptions?: readonly EventOption[]
  lodgingTaken?: Readonly<Record<string, number>>
  heldLodging?: string | null
  signedInMember?: boolean
}) => {
  const change = (part: Partial<StayDraft>) => onChange({ ...draft, ...part })

  return (
    <>
      <label class="field">
        <span>Arriving</span>
        <input
          type="date"
          name="arrival_date"
          max={draft.departure_date === '' ? undefined : draft.departure_date}
          value={draft.arrival_date}
          onInput={(event) => change({ arrival_date: event.currentTarget.value })}
        />
      </label>

      <label class="field">
        <span>Leaving</span>
        <input
          type="date"
          name="departure_date"
          min={draft.arrival_date === '' ? undefined : draft.arrival_date}
          value={draft.departure_date}
          onInput={(event) => change({ departure_date: event.currentTarget.value })}
        />
      </label>

      {signedInMember && (
        <p class="form-note">
          <a href="/rides">Looking for a lift, or offering one?</a>
        </p>
      )}

      <label class="field">
        <span>Where are you sleeping?</span>
        <select
          name="lodging_option_id"
          value={draft.lodging_option_id}
          onChange={(event) => change({ lodging_option_id: event.currentTarget.value })}
        >
          <option value="">Not decided yet</option>
          {lodgingOptions.map((option) => {
            const full = option.capacity !== null && (lodgingTaken[option.id] ?? 0) >= option.capacity
            const theirs = option.id === heldLodging

            return (
              <option key={option.id} value={option.id} disabled={full && !theirs}>
                {option.label}
                {option.capacity === null
                  ? ''
                  : full
                    ? ' — full'
                    : ` — ${option.capacity - (lodgingTaken[option.id] ?? 0)} left`}
              </option>
            )
          })}
        </select>
      </label>

      {signedInMember && (
        <p class="form-note">
          <a href="/options">(edit lodging alternatives)</a>
        </p>
      )}

      <fieldset class="field">
        <legend>What would you like to help with?</legend>

        {helpingOptions.length === 0 && (
          <p class="form-note">Nothing listed yet — write it in below if you already know.</p>
        )}

        {helpingOptions.map((option) => (
          <label key={option.id} class="field-inline">
            <input
              type="checkbox"
              checked={draft.helping_option_ids.includes(option.id)}
              onChange={(event) =>
                change({
                  helping_option_ids: event.currentTarget.checked
                    ? [...draft.helping_option_ids, option.id]
                    : draft.helping_option_ids.filter((id) => id !== option.id),
                })
              }
            />
            <span>{option.label}</span>
          </label>
        ))}

        <label class="field">
          <span>Something else</span>
          <input
            type="text"
            name="helping_other"
            maxLength={MAX_OPTION_LABEL}
            value={draft.helping_other}
            onInput={(event) => change({ helping_other: event.currentTarget.value })}
          />
        </label>
      </fieldset>

      <label class="field">
        <span>Anything else we should know?</span>
        <textarea
          name="notes"
          maxLength={MAX_NOTES}
          rows={rowsFor(draft.notes)}
          value={draft.notes}
          onInput={(event) => change({ notes: event.currentTarget.value })}
        />
      </label>
    </>
  )
}
