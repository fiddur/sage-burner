import type { EventAttendeesResponse, Place, Session, SessionUpdate } from '@sage-burner/shared'

import { useState } from 'preact/hooks'

import { toLocalInput } from '../datetime.ts'
import { renderMarkdown } from '../markdown.ts'
import { DreamFields } from './DreamFields.tsx'
import { DreamPanel } from './DreamPanel.tsx'

/**
 * One dream, opened from the grid — read, edited or withdrawn without leaving it.
 *
 * The Dreams page keeps the same form for the list view; both use `DreamFields`.
 */
export const DreamDetails = ({
  dream,
  places,
  attendees,
  facilitatorName,
  viewerId,
  busy,
  onClose,
  onHelp,
  onSupport,
  onSave,
  onRemove,
}: {
  dream: Session
  places: readonly Place[]
  attendees: readonly EventAttendeesResponse['attendees'][number][]
  facilitatorName: string | null | undefined
  /** Who is reading it, so the button can say "I cannot help after all". */
  viewerId: string | undefined
  busy: boolean
  onClose: () => void
  /** `true` to offer, `false` to take the offer back. */
  onHelp: (helping: boolean) => void
  onSupport: (supporting: boolean) => void
  onSave: (changes: SessionUpdate) => void
  onRemove: () => void
}) => {
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)

  // Read off the list rather than carried as its own field. `supported_by_me` exists
  // only because the supporters are a count and nothing more.
  const helping = dream.helpers.some((person) => person.account_id === viewerId)

  const place = places.find((lane) => lane.id === dream.place_id)

  return (
    <DreamPanel label={dream.title} onClose={onClose}>
      <h2>{dream.title}</h2>

      {editing ? (
        <DreamFields
          dream={dream}
          subject={dream.title}
          places={places}
          attendees={attendees}
          busy={busy}
          onCancel={() => setEditing(false)}
          onSave={(changes) => {
            onSave(changes)
            setEditing(false)
          }}
        />
      ) : (
        <>
          <p class="form-note">
            {whenAndWhere(dream, place)}
            {dream.facilitator_account_id !== null && (
              <> · Facilitated by {facilitatorName ?? 'somebody who has no name filled in'}</>
            )}
          </p>

          {dream.description.trim() !== '' && (
            // Safe by construction: `renderMarkdown` escapes raw HTML rather than filtering it.
            <div
              class="markdown-preview"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(dream.description) }}
            />
          )}

          <p class="row">
            <button
              type="button"
              class="dream-heart"
              disabled={busy}
              aria-pressed={dream.supported_by_me}
              aria-label={dream.supported_by_me ? 'Take back your support' : 'Show support'}
              onClick={() => onSupport(!dream.supported_by_me)}
            >
              <span aria-hidden="true">{dream.supported_by_me ? '❤️‍🔥' : '♡'}</span> {dream.support_count}
            </button>
            <span class="form-note">
              {dream.support_count === 1 ? '1 person wants this' : `${dream.support_count} people want this`}
            </span>
          </p>

          <h3>Helping out</h3>

          {dream.helpers.length === 0 ? (
            <p class="form-note">Nobody has offered to help yet.</p>
          ) : (
            <ul class="dream-helpers">
              {dream.helpers.map((person) => (
                <li key={person.account_id}>{person.name ?? 'Someone without a name yet'}</li>
              ))}
            </ul>
          )}

          <p class="row">
            <button type="button" disabled={busy} onClick={() => onHelp(!helping)}>
              {helping ? 'I cannot help after all' : 'I want to help out'}
            </button>
            <button
              type="button"
              class="link-button"
              disabled={busy}
              aria-label={`Edit ${dream.title}`}
              onClick={() => setEditing(true)}
            >
              ✏️
            </button>
            {confirming ? (
              <>
                <span class="form-note">Withdraw it? Its helpers and hearts go too.</span>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Really withdraw ${dream.title}`}
                  onClick={onRemove}
                >
                  Withdraw it
                </button>
                <button
                  type="button"
                  class="link-button"
                  disabled={busy}
                  onClick={() => setConfirming(false)}
                >
                  Keep it
                </button>
              </>
            ) : (
              <button
                type="button"
                class="link-button"
                disabled={busy}
                aria-label={`Withdraw ${dream.title}`}
                onClick={() => setConfirming(true)}
              >
                🗑️
              </button>
            )}
            <button type="button" class="link-button" onClick={onClose}>
              Close
            </button>
          </p>
        </>
      )}
    </DreamPanel>
  )
}

const whenAndWhere = (dream: Session, place: Place | undefined) => {
  const where = place === undefined ? '' : ` · ${place.emoji} ${place.name}`
  if (dream.time_slot_start === null || dream.time_slot_end === null) return `Not scheduled yet${where}`

  const from = toLocalInput(dream.time_slot_start)

  return `${from.slice(0, 10)} ${from.slice(11)}–${toLocalInput(dream.time_slot_end).slice(11)}${where}`
}
