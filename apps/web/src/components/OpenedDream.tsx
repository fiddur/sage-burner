import type { EventAttendeesResponse, Place, Session, SessionUpdate, Thread } from '@sage-burner/shared'

import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'
import type { UploadImage } from '../image-upload.ts'

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

export type Opened =
  | { kind: 'dream'; id: string; editing: boolean }
  | { kind: 'new'; place_id: string | null; time_slot_start: string | null; time_slot_end: string | null }

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

export interface DreamTalk {
  thread: Thread | undefined
  say: (body: string) => void
  rewrite: (id: string, body: string) => void
  remove: (id: string) => void
}

export const threadOf = (
  dreams: readonly Session[],
  opened: Opened | undefined,
): string | null | undefined =>
  opened?.kind === 'dream' ? dreams.find((one) => one.id === opened.id)?.thread_id : undefined

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

  // `useLoad` keeps the last successful data across a key change, so opening dream B while A's
  // thread is loaded rendered A's entries under B's panel for one round trip (#387).
  const answered = loaded.status === 'ready' ? loaded.data : undefined
  const fetched = answered?.id === threadId ? answered : undefined
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
  upload,
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
  talk: DreamTalk
  viewerId: string | undefined
  admin: boolean
  busy: boolean
  error: string | undefined
  upload: UploadImage
  onEdit: (id: string) => void
  onCancelEdit: (id: string) => void
  onClose: () => void
  onFacilitate: (id: string, accountId: string | null) => void
  onHelp: (id: string, helping: boolean, accountId: string) => void
  onSupport: (id: string, supporting: boolean) => void
  onSave: (id: string, changes: SessionUpdate) => void
  onOffer?: (fields: SessionUpdate) => void
  onRemove: (id: string) => void
}) => {
  if (opened === undefined) return null

  if (opened.kind === 'new') {
    if (onOffer === undefined) return null

    return (
      <DreamPanel label="Offer a dream" error={error} onClose={onClose} onBack={() => undefined}>
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
          upload={upload}
          onCancel={onClose}
          onSave={onOffer}
        />
      </DreamPanel>
    )
  }

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
          : (facilitating ?? { account_id: dream.facilitator_account_id, name: null })
      }
      talk={talk}
      viewerId={viewerId}
      admin={admin}
      busy={busy}
      error={error}
      editing={opened.editing}
      upload={upload}
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
