import type { EventAttendeesResponse, Place, Session, SessionUpdate, Thread } from '@sage-burner/shared'

import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { useLoad } from '../load.ts'
import { DreamDetails } from './DreamDetails.tsx'
import { DreamFields } from './DreamFields.tsx'
import { DreamPanel } from './DreamPanel.tsx'

export type OpenedDreamApi = Pick<
  ApiClient,
  | 'updateSession'
  | 'withdrawSession'
  | 'helpWithSession'
  | 'stopHelpingWithSession'
  | 'supportSession'
  | 'withdrawSupportForSession'
>

/**
 * What the panel is showing: an existing dream, or a new one being offered.
 *
 * The existing case holds an id rather than the dream, so a reload after a heart or
 * a helper leaves the panel showing what the server now says.
 */
export type Opened =
  | { kind: 'dream'; id: string; editing: boolean }
  | { kind: 'new'; place_id: string | null; time_slot_start: string | null; time_slot_end: string | null }

/**
 * Every write the panel makes, for both pages that open one (#342).
 *
 * The Dreams page used to swap a row for an edit form of its own, so a dream had two
 * ways to be read and two to be edited — and only one of them had #205's "keep what
 * was typed when the save is refused" and #207's two-step Escape. One set of handlers
 * rather than a second copy that starts a step behind.
 *
 * Each one closes or steps the panel **only once the write has landed**. Closing on
 * the click threw the member's typing away whenever the server said no, and that is
 * an ordinary path rather than a corner: filling Starts and leaving Ends empty is
 * half a slot, which the schema refuses with a 400.
 */
export const dreamActions = ({
  api,
  run,
  setOpened,
}: {
  api: OpenedDreamApi
  run: (work: () => Promise<unknown>, fallback: string) => void
  setOpened: (next: Opened | undefined) => void
}) => ({
  support: (id: string, supporting: boolean) => {
    run(
      () => (supporting ? api.supportSession(id) : api.withdrawSupportForSession(id)),
      'Could not save that.',
    )
  },

  help: (id: string, helping: boolean, accountId: string) => {
    run(
      () =>
        helping
          ? api.helpWithSession(id, { account_id: accountId })
          : api.stopHelpingWithSession(id, accountId),
      'Could not save that.',
    )
  },

  // The panel stays open: taking the spot is not finishing with the dream, and the
  // reload puts the name into the strip where the click was.
  facilitate: (id: string, accountId: string | null) => {
    run(() => api.updateSession(id, { facilitator_account_id: accountId }), 'Could not save that.')
  },

  save: (id: string, changes: SessionUpdate) => {
    run(async () => {
      await api.updateSession(id, changes)
      setOpened({ kind: 'dream', id, editing: false })
    }, 'Could not save that.')
  },

  remove: (id: string) => {
    run(async () => {
      await api.withdrawSession(id)
      setOpened(undefined)
    }, 'Could not withdraw that.')
  },
})

export type DreamTalkApi = Pick<ApiClient, 'getThread' | 'postComment' | 'updateComment' | 'deleteComment'>

/** The conversation about whichever dream is open, and every way of adding to it. */
export interface DreamTalk {
  thread: Thread | undefined
  say: (body: string) => void
  rewrite: (id: string, body: string) => void
  remove: (id: string) => void
}

/** Which conversation the open panel is about, or nothing while none is open. */
export const threadOf = (
  dreams: readonly Session[],
  opened: Opened | undefined,
): string | null | undefined =>
  opened?.kind === 'dream' ? dreams.find((one) => one.id === opened.id)?.thread_id : undefined

/**
 * The thread the open dream carries (#375), for both pages that open one.
 *
 * Fetched here rather than with the dreams: the grid loads every dream for a burn and
 * wants none of this, and a conversation is the one read the service worker deliberately
 * does not keep. Keyed on the thread id, so opening another dream fetches another
 * conversation and closing the panel stops asking for one at all.
 *
 * Every write answers with the whole thread, so this holds what came back rather than
 * reloading — the page's own reload is about the dreams, and a comment changes none of
 * them.
 */
export const useDreamThread = ({
  api,
  threadId,
  run,
}: {
  api: DreamTalkApi
  threadId: string | null | undefined
  run: (work: () => Promise<unknown>, fallback: string) => void
}): DreamTalk => {
  const [held, setHeld] = useState<Thread | undefined>(undefined)

  const { loaded } = useLoad<Thread | undefined>(
    async (signal) => (threadId == null ? undefined : (await api.getThread(threadId, signal)).thread),
    {
      enabled: threadId != null,
      key: threadId ?? '',
      fallback: 'Could not load what has been said about this.',
    },
  )

  const fetched = loaded.status === 'ready' ? loaded.data : undefined
  // What came back from a write wins, but only while it is about the thread being shown
  // — otherwise closing one dream and opening another would show the first one's talk
  // until the fetch landed.
  const thread = held?.id === fetched?.id && held !== undefined ? held : fetched

  const after = (work: () => Promise<{ thread: Thread }>, fallback: string) => {
    run(async () => setHeld((await work()).thread), fallback)
  }

  return {
    thread,
    say: (body) => {
      if (threadId == null) return

      after(() => api.postComment(threadId, { body }), 'Could not say that.')
    },
    rewrite: (id, body) => after(() => api.updateComment(id, { body }), 'Could not save that.'),
    remove: (id) => after(() => api.deleteComment(id), 'Could not take that back.'),
  }
}

/**
 * Whichever dream panel is open, or nothing.
 *
 * Its own component so a page keeps one branch where it had several — the same
 * reason `NoBurn` is one — and shared between the grid and the Dreams page so the
 * two cannot come to show a dream differently.
 */
export const OpenedDream = ({
  opened,
  dreams,
  places,
  attendees,
  talk,
  viewerId,
  admin,
  busy,
  error,
  onEdit,
  onCancelEdit,
  onClose,
  onFacilitate,
  onHelp,
  onSupport,
  onSave,
  onOffer,
  onRemove,
}: {
  opened: Opened | undefined
  dreams: readonly Session[]
  places: readonly Place[]
  attendees: readonly EventAttendeesResponse['attendees'][number][]
  /** What has been said about the open dream, and every way of adding to it (#375). */
  talk: DreamTalk
  viewerId: string | undefined
  /** An admin may take a comment off. Nobody may rewrite somebody else's. */
  admin: boolean
  busy: boolean
  error: string | undefined
  onEdit: (id: string) => void
  onCancelEdit: (id: string) => void
  onClose: () => void
  onFacilitate: (id: string, accountId: string | null) => void
  onHelp: (id: string, helping: boolean, accountId: string) => void
  onSupport: (id: string, supporting: boolean) => void
  onSave: (id: string, changes: SessionUpdate) => void
  /**
   * Absent on a page that never opens `{ kind: 'new' }`. The Dreams page offers by
   * name from a form of its own, so wiring it an unreachable handler meant inventing
   * an event id it does not always have.
   */
  onOffer?: (fields: SessionUpdate) => void
  onRemove: (id: string) => void
}) => {
  if (opened === undefined) return null

  if (opened.kind === 'new') {
    if (onOffer === undefined) return null

    return (
      <DreamPanel
        label="Offer a dream"
        error={error}
        onClose={onClose}
        // Escape and the backdrop take this step instead of closing — and here the
        // step is nothing. There is no dream behind an offer panel to fall back to,
        // so a stray press threw away everything typed into the form, which is the
        // most typing anywhere in the grid. Cancel is the way out, and it is in the
        // form (#295).
        onBack={() => undefined}
      >
        <h2>Offer a dream</h2>
        <DreamFields
          dream={{
            title: '',
            description: '',
            facilitator_account_id: null,
            repeatable: false,
            place_id: opened.place_id,
            time_slot_start: opened.time_slot_start,
            time_slot_end: opened.time_slot_end,
          }}
          subject="the new dream"
          places={places}
          attendees={attendees}
          busy={busy}
          creating
          onCancel={onClose}
          onSave={onOffer}
        />
      </DreamPanel>
    )
  }

  // Looked up rather than held, so a reload after a heart or a helper leaves the
  // panel showing what the server now says.
  const dream = dreams.find((candidate) => candidate.id === opened.id)
  if (dream === undefined) return null

  const facilitating = attendees.find((person) => person.account_id === dream.facilitator_account_id)

  return (
    <DreamDetails
      dream={dream}
      places={places}
      attendees={attendees}
      facilitator={
        dream.facilitator_account_id === null
          ? undefined
          : // Falling back to the bare id keeps whoever is running it visible — and
            // removable — if they are no longer among the burn's attendees.
            (facilitating ?? { account_id: dream.facilitator_account_id, name: null })
      }
      talk={talk}
      viewerId={viewerId}
      admin={admin}
      busy={busy}
      error={error}
      editing={opened.editing}
      onEdit={() => onEdit(dream.id)}
      onCancelEdit={() => onCancelEdit(dream.id)}
      onClose={onClose}
      onFacilitate={(accountId) => onFacilitate(dream.id, accountId)}
      onHelp={(helping, accountId) => onHelp(dream.id, helping, accountId)}
      onSupport={(supporting) => onSupport(dream.id, supporting)}
      onSave={(changes) => onSave(dream.id, changes)}
      onRemove={() => onRemove(dream.id)}
    />
  )
}
