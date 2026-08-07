import type { EventAttendeesResponse, Place, Session, SessionUpdate } from '@sage-burner/shared'

import type { Person } from './HelperStrip.tsx'

import { toLocalInput } from '../datetime.ts'
import { renderMarkdown } from '../markdown.ts'
import { Avatar } from './Avatar.tsx'
import { DreamFields } from './DreamFields.tsx'
import { DreamPanel } from './DreamPanel.tsx'
import { HelperStrip } from './HelperStrip.tsx'
import { IconButton } from './IconButton.tsx'
import { NAMELESS } from './PersonBadge.tsx'
import { WithdrawDream } from './WithdrawDream.tsx'

/**
 * One dream, opened from the grid — read, edited or withdrawn without leaving it.
 *
 * The Dreams page keeps the same form for the list view; both use `DreamFields`.
 */
export const DreamDetails = ({
  dream,
  places,
  attendees,
  facilitator,
  viewerId,
  busy,
  error,
  editing,
  onEdit,
  onCancelEdit,
  onClose,
  onFacilitate,
  onHelp,
  onSupport,
  onSave,
  onRemove,
}: {
  dream: Session
  places: readonly Place[]
  attendees: readonly EventAttendeesResponse['attendees'][number][]
  /** Whoever is running it, resolved to a name by the page. Absent while nobody is. */
  facilitator: Person | undefined
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
  /** Who is running it now, or `null` to leave it to nobody. */
  onFacilitate: (accountId: string | null) => void
  /** `true` to offer, `false` to take the offer back. */
  onHelp: (helping: boolean, accountId: string) => void
  onSupport: (supporting: boolean) => void
  onSave: (changes: SessionUpdate) => void
  onRemove: () => void
}) => {
  const place = places.find((lane) => lane.id === dream.place_id)

  return (
    <DreamPanel
      label={dream.title}
      error={error}
      onBack={editing ? onCancelEdit : undefined}
      onClose={onClose}
    >
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
          <p class="form-note">{whenAndWhere(dream, place)}</p>

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
                  const who = person.name ?? NAMELESS

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

          <h3>Facilitating</h3>

          {/* The same control as everywhere else somebody takes a job (#247), rather
              than a line of prose only the edit form could change.

              The exclusion runs both ways: somebody already helping is not offered as
              facilitator either, since appointing them would leave them holding both
              of a pair the strip below treats as exclusive (#295). */}
          <HelperStrip
            label={`${dream.title} as facilitator`}
            people={facilitator === undefined ? [] : [facilitator]}
            max={1}
            candidates={attendees.filter(
              (person) => !dream.helpers.some((helper) => helper.account_id === person.account_id),
            )}
            everyone={attendees}
            viewerId={viewerId}
            busy={busy}
            onAdd={(accountId) => onFacilitate(accountId)}
            onRemove={() => onFacilitate(null)}
          />

          <h3>Helping out</h3>

          {/* The facilitator is running it, so they are not offered as a pair of
              hands for it. The other half of the same rule is above. */}
          <HelperStrip
            label={dream.title}
            people={dream.helpers}
            candidates={attendees.filter((person) => person.account_id !== dream.facilitator_account_id)}
            everyone={attendees}
            viewerId={viewerId}
            busy={busy}
            onAdd={(accountId) => onHelp(true, accountId)}
            onRemove={(accountId) => onHelp(false, accountId)}
          />

          <p class="row">
            <IconButton icon="✏️" label={`Edit ${dream.title}`} disabled={busy} onClick={onEdit} />
            <WithdrawDream title={dream.title} busy={busy} onWithdraw={onRemove} />
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
