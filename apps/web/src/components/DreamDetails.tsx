import type { EventAttendeesResponse, Place, Session, SessionUpdate } from '@sage-burner/shared'

import type { UploadImage } from '../image-upload.ts'
import type { Person } from './HelperStrip.tsx'
import type { DreamTalk } from './OpenedDream.tsx'

import { toLocalInput } from '../datetime.ts'
import { renderMarkdown } from '../markdown.ts'
import { DreamFields } from './DreamFields.tsx'
import { DreamPanel } from './DreamPanel.tsx'
import { DreamThread } from './DreamThread.tsx'
import { Faces } from './Faces.tsx'
import { HelperStrip } from './HelperStrip.tsx'
import { IconButton } from './IconButton.tsx'
import { WithdrawDream } from './WithdrawDream.tsx'

export const DreamDetails = ({
  dream,
  places,
  attendees,
  facilitator,
  talk,
  viewerId,
  admin,
  busy,
  error,
  editing,
  upload,
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
  facilitator: Person | undefined
  talk: DreamTalk
  viewerId: string | undefined
  admin: boolean
  busy: boolean
  error: string | undefined
  editing: boolean
  upload: UploadImage
  onEdit: () => void
  onCancelEdit: () => void
  onClose: () => void
  onFacilitate: (accountId: string | null) => void
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
          upload={upload}
          onCancel={onCancelEdit}
          onSave={onSave}
        />
      ) : (
        <>
          <p class="form-note">{whenAndWhere(dream, place)}</p>

          {dream.description.trim() !== '' && (
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
            {dream.supporters.length === 0 ? (
              <span class="form-note">Nobody has said they want this yet.</span>
            ) : (
              <Faces people={dream.supporters} />
            )}
          </p>

          <h3>Facilitating</h3>

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

          <h3>Talk</h3>

          <DreamThread
            thread={talk.thread}
            viewerId={viewerId}
            admin={admin}
            busy={busy}
            more={false}
            upload={upload}
            people={attendees}
            onSay={talk.say}
            onRewrite={talk.rewrite}
            onRemove={talk.remove}
          />
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
