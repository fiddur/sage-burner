import type { EventAttendeesResponse, Place, Session, SessionUpdate } from '@sage-burner/shared'

import { useState } from 'preact/hooks'

import { toLocalInput } from '../datetime.ts'
import { renderMarkdown } from '../markdown.ts'
import { Avatar } from './Avatar.tsx'
import { DreamFields } from './DreamFields.tsx'
import { DreamPanel } from './DreamPanel.tsx'
import { HelperStrip } from './HelperStrip.tsx'

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
  error,
  editing,
  onEdit,
  onCancelEdit,
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
  error: string | undefined
  /**
   * Owned by the page, not held here: the form must stay open when a save is
   * refused, and only the page knows whether one was. Closing it on the click
   * threw away everything the member had typed.
   */
  editing: boolean
  onEdit: () => void
  onCancelEdit: () => void
  onClose: () => void
  /** `true` to offer, `false` to take the offer back. */
  onHelp: (helping: boolean, accountId: string) => void
  onSupport: (supporting: boolean) => void
  onSave: (changes: SessionUpdate) => void
  onRemove: () => void
}) => {
  const [confirming, setConfirming] = useState(false)

  // Dropped whenever the panel switches between reading and editing (#208). Without
  // it, 🗑️ then ✏️ then Cancel comes back to a "Withdraw it?" nobody is still asking:
  // `confirming` is local state, and nothing else resets it.
  const [confirmingFor, setConfirmingFor] = useState(editing)
  if (confirmingFor !== editing) {
    setConfirmingFor(editing)
    setConfirming(false)
  }

  const place = places.find((lane) => lane.id === dream.place_id)

  return (
    <DreamPanel label={dream.title} error={error} onClose={onClose}>
      <h2>{dream.title}</h2>

      {editing ? (
        <DreamFields
          dream={dream}
          subject={dream.title}
          places={places}
          attendees={attendees}
          busy={busy}
          onCancel={onCancelEdit}
          onSave={onSave}
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
            {/* Faces rather than a number (#251): "2 people want this" is the same
                sentence whoever they are, and on a page about who is coming, who is
                the interesting part. The count stays on the button, where a chip in
                the grid has no room for faces. */}
            {dream.supporters.length === 0 ? (
              <span class="form-note">Nobody has said they want this yet.</span>
            ) : (
              <span class="dream-supporters">
                {dream.supporters.map((person) => {
                  const who = person.name ?? 'Someone without a name yet'

                  return (
                    // Wrapped for the name: `Avatar` draws `alt=""` because a name is
                    // normally beside it, and in a stack of faces there is none.
                    <span key={person.account_id} class="dream-supporter" title={who}>
                      <Avatar
                        accountId={person.account_id}
                        name={person.name}
                        avatar={person.avatar}
                        size="dream-facilitator"
                      />
                      <span class="visually-hidden">{who}</span>
                    </span>
                  )
                })}
              </span>
            )}
          </p>

          <h3>Helping out</h3>

          {/* The facilitator is running it, so they are not offered as a pair of
              hands for it — the one exclusion a dream has. */}
          <HelperStrip
            label={dream.title}
            people={dream.helpers}
            candidates={attendees.filter((person) => person.account_id !== dream.facilitator_account_id)}
            viewerId={viewerId}
            busy={busy}
            onAdd={(accountId) => onHelp(true, accountId)}
            onRemove={(accountId) => onHelp(false, accountId)}
          />

          <p class="row">
            <button
              type="button"
              class="link-button"
              disabled={busy}
              aria-label={`Edit ${dream.title}`}
              onClick={onEdit}
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
