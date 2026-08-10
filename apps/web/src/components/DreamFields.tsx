import {
  type EventAttendeesResponse,
  MAX_DESCRIPTION,
  MAX_TITLE,
  type Place,
  type SessionUpdate,
} from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { UploadImage } from '../image-upload.ts'

import { fromLocalInput, toLocalInput } from '../datetime.ts'
import { stillUploading } from '../image-upload.ts'
import { MarkdownField } from './MarkdownField.tsx'

export interface DreamDraft {
  title: string
  description: string
  facilitator_account_id: string | null
  repeatable: boolean
  place_id: string | null
  time_slot_start: string | null
  time_slot_end: string | null
}

export const DreamFields = ({
  dream,
  subject,
  places,
  attendees,
  busy,
  creating = false,
  upload,
  onSave,
  onCancel,
}: {
  dream: DreamDraft
  subject: string
  places: readonly Place[]
  attendees: readonly EventAttendeesResponse['attendees'][number][]
  busy: boolean
  creating?: boolean
  upload: UploadImage
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
        upload={upload}
        onInput={setDescription}
      />

      <label class="field">
        <span>Who is facilitating?</span>
        <select
          aria-label={`Facilitator for ${subject}`}
          value={facilitator}
          onChange={(changeEvent) => setFacilitator(changeEvent.currentTarget.value)}
        >
          <option value="">Nobody yet</option>
          {facilitator !== '' && !attendees.some((person) => person.account_id === facilitator) && (
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
        disabled={busy || stillUploading(description) || (creating && title.trim() === '')}
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
