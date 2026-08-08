import {
  type EventAttendeesResponse,
  type SessionUpdate,
  MAX_DESCRIPTION,
  MAX_TITLE,
  type Place,
} from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import { fromLocalInput, toLocalInput } from '../datetime.ts'
import { MarkdownField } from './MarkdownField.tsx'

/** What the form edits. A stored `Session` is one; so is a blank one being offered. */
export interface DreamDraft {
  title: string
  description: string
  facilitator_account_id: string | null
  repeatable: boolean
  place_id: string | null
  time_slot_start: string | null
  time_slot_end: string | null
}

/**
 * The form for one dream, inside the panel both pages open (#342).
 *
 * `creating` changes two things: the button says so, and every field is emitted
 * rather than only the changed ones. The diff exists to protect a concurrent
 * editor's work, and a dream that does not exist yet has none to protect — while a
 * slot prefilled from the cell somebody clicked would be diffed away as unchanged.
 */
export const DreamFields = ({
  dream,
  subject,
  places,
  attendees,
  busy,
  creating = false,
  onSave,
  onCancel,
}: {
  dream: DreamDraft
  /** What the field labels call it, since a dream being offered has no title yet. */
  subject: string
  places: readonly Place[]
  attendees: readonly EventAttendeesResponse['attendees'][number][]
  busy: boolean
  creating?: boolean
  onSave: (changes: SessionUpdate) => void
  onCancel: () => void
}) => {
  const [title, setTitle] = useState(dream.title)
  const [facilitator, setFacilitator] = useState(dream.facilitator_account_id ?? '')
  const [description, setDescription] = useState(dream.description)
  const [repeatable, setRepeatable] = useState(dream.repeatable)
  const [placeId, setPlaceId] = useState(dream.place_id ?? '')
  const [start, setStart] = useState(toLocalInput(dream.time_slot_start))
  const [end, setEnd] = useState(toLocalInput(dream.time_slot_end))

  const all = (): SessionUpdate => ({
    title: title.trim(),
    description,
    place_id: placeId === '' ? null : placeId,
    time_slot_start: fromLocalInput(start),
    time_slot_end: fromLocalInput(end),
    facilitator_account_id: facilitator === '' ? null : facilitator,
    repeatable,
  })

  // Only the fields this form actually changed. Sending all of them would carry the
  // values it loaded at mount, so fixing a typo in the title would put the place
  // and slot back as they were then, undoing whatever someone else scheduled
  // meanwhile — the ordinary case on a page several people edit at once.
  //
  // Each comparison is in the form's own units. Comparing a round-tripped
  // timestamp against the stored one instead would call an untouched slot
  // changed whenever the stored value carries seconds, because the inputs are
  // minute-precision, and quietly zero them.
  const edits = (): SessionUpdate => ({
    ...(title.trim() === dream.title ? {} : { title: title.trim() }),
    ...(description === dream.description ? {} : { description }),
    ...(placeId === (dream.place_id ?? '') ? {} : { place_id: placeId === '' ? null : placeId }),
    ...(start === toLocalInput(dream.time_slot_start) ? {} : { time_slot_start: fromLocalInput(start) }),
    ...(end === toLocalInput(dream.time_slot_end) ? {} : { time_slot_end: fromLocalInput(end) }),
    ...(facilitator === (dream.facilitator_account_id ?? '')
      ? {}
      : { facilitator_account_id: facilitator === '' ? null : facilitator }),
    ...(repeatable === dream.repeatable ? {} : { repeatable }),
  })

  return (
    <div class="dream-edit">
      <label class="field">
        <span>What is it?</span>
        <input
          type="text"
          maxLength={MAX_TITLE}
          aria-label={`Title of ${subject}`}
          value={title}
          onInput={(inputEvent) => setTitle(inputEvent.currentTarget.value)}
        />
      </label>

      <MarkdownField
        label="Tell people about it"
        accessibleName={`Description of ${subject}`}
        value={description}
        maxLength={MAX_DESCRIPTION}
        onInput={setDescription}
      />

      {/* Only people coming to this burn: the API refuses anyone else, since
          somebody who is not there cannot run it. */}
      <label class="field">
        <span>Who is facilitating?</span>
        <select
          aria-label={`Facilitator for ${subject}`}
          value={facilitator}
          onChange={(changeEvent) => setFacilitator(changeEvent.currentTarget.value)}
        >
          <option value="">Nobody yet</option>
          {facilitator !== '' &&
            !attendees.some((person) => person.account_id === facilitator) && (
              // They have withdrawn since being handed this. Named rather than left
              // out, or the control reads as "Nobody yet" while the id is still stored
              // — and saving anything else would keep a facilitator the page denies
              // having. Disabled, so it can be left or changed but not chosen.
              <option value={facilitator} disabled>
                Somebody who is no longer coming
              </option>
            )}
          {attendees.map((person) => (
            <option key={person.account_id} value={person.account_id}>
              {person.name ?? 'Name not filled in yet'}
            </option>
          ))}
        </select>
      </label>

      <label class="field">
        <span>Where</span>
        <select
          aria-label={`Place for ${subject}`}
          value={placeId}
          onChange={(changeEvent) => setPlaceId(changeEvent.currentTarget.value)}
        >
          <option value="">Nowhere yet</option>
          {places.map((row) => (
            <option key={row.id} value={row.id}>
              {row.emoji} {row.name}
            </option>
          ))}
        </select>
      </label>

      <label class="field">
        <span>Starts</span>
        <input
          type="datetime-local"
          aria-label={`Start of ${subject}`}
          max={end === '' ? undefined : end}
          value={start}
          onInput={(inputEvent) => setStart(inputEvent.currentTarget.value)}
        />
      </label>

      <label class="field">
        <span>Ends</span>
        <input
          type="datetime-local"
          aria-label={`End of ${subject}`}
          min={start === '' ? undefined : start}
          value={end}
          onInput={(inputEvent) => setEnd(inputEvent.currentTarget.value)}
        />
      </label>

      {/* Placing it in the grid then copies it rather than moving it. */}
      <label class="field-inline">
        <input
          type="checkbox"
          aria-label={`Plan ${subject} more than once`}
          checked={repeatable}
          onChange={(changeEvent) => setRepeatable(changeEvent.currentTarget.checked)}
        />
        <span>Can be planned more than once</span>
      </label>

      <button
        type="button"
        disabled={busy || (creating && title.trim() === '')}
        onClick={() => onSave(creating ? all() : edits())}
      >
        {creating ? 'Offer it' : 'Save'}
      </button>
      <button type="button" class="link-button" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}
