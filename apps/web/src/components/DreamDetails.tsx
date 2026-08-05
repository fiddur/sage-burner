import type { Place, Session } from '@sage-burner/shared'

import { useEffect, useRef } from 'preact/hooks'

import { toLocalInput } from '../datetime.ts'
import { renderMarkdown } from '../markdown.ts'

/**
 * One dream, opened from the grid. Read-only apart from the two buttons — precise
 * editing stays on Dreams, which has the form.
 *
 * Not a `<dialog>`: `showModal` is an imperative call on a ref, and the focus trap
 * it brings is then a second thing to keep in step with this component's own open
 * state. `role="dialog"` with `aria-modal` says the same to a screen reader.
 */
export const DreamDetails = ({
  dream,
  place,
  facilitatorName,
  viewerId,
  busy,
  onClose,
  onHelp,
  onSupport,
}: {
  dream: Session
  place: Place | undefined
  facilitatorName: string | null | undefined
  /** Who is reading it, so the button can say "I cannot help after all". */
  viewerId: string | undefined
  busy: boolean
  onClose: () => void
  /** `true` to offer, `false` to take the offer back. */
  onHelp: (helping: boolean) => void
  onSupport: (supporting: boolean) => void
}) => {
  const panel = useRef<HTMLDivElement>(null)

  // Read off the list rather than carried as its own field. `supported_by_me` exists
  // only because the supporters are a count and nothing more.
  const helping = dream.helpers.some((person) => person.account_id === viewerId)

  // Focus moves in, or Escape reaches nothing.
  useEffect(() => {
    panel.current?.focus()
  }, [])

  return (
    <div
      class="dream-modal"
      onClick={onClose}
      onKeyDown={(keyEvent) => {
        if (keyEvent.key === 'Escape') onClose()
      }}
    >
      <div
        class="dream-panel"
        role="dialog"
        aria-modal="true"
        aria-label={dream.title}
        tabIndex={-1}
        ref={panel}
        // Reading the description must not close the thing you opened to read it.
        onClick={(clickEvent) => clickEvent.stopPropagation()}
      >
        <h2>{dream.title}</h2>

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
            class="link-button"
            disabled={busy}
            aria-pressed={dream.supported_by_me}
            aria-label={dream.supported_by_me ? 'Take back your support' : 'Show support'}
            onClick={() => onSupport(!dream.supported_by_me)}
          >
            <span aria-hidden="true">{dream.supported_by_me ? '❤️‍🔥' : '♡'}</span> {dream.support_count}
          </button>{' '}
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
          <button type="button" class="link-button" onClick={onClose}>
            Close
          </button>
        </p>

        <p class="form-note">
          Times, place and description are edited on <a href="/dreams">Dreams</a>.
        </p>
      </div>
    </div>
  )
}

const whenAndWhere = (dream: Session, place: Place | undefined) => {
  const where = place === undefined ? '' : ` · ${place.emoji} ${place.name}`
  if (dream.time_slot_start === null || dream.time_slot_end === null) return `Not scheduled yet${where}`

  const from = toLocalInput(dream.time_slot_start)

  return `${from.slice(0, 10)} ${from.slice(11)}–${toLocalInput(dream.time_slot_end).slice(11)}${where}`
}
