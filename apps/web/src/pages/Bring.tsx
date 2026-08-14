import type { BringEntry, EventAttendeesResponse } from '@sage-burner/shared'

import { BRING_PARAM, MAX_NOTES, MAX_TITLE, profilePage } from '@sage-burner/shared'
import { useLocation } from 'preact-iso'
import { useEffect, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'
import type { DreamTalk } from '../components/OpenedDream.tsx'
import type { UploadImage } from '../image-upload.ts'

import { useSelectedBurn } from '../burn.tsx'
import { Destroy } from '../components/Destroy.tsx'
import { DreamThread } from '../components/DreamThread.tsx'
import { ErrorText } from '../components/ErrorText.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { HelperStrip } from '../components/HelperStrip.tsx'
import { IconButton } from '../components/IconButton.tsx'
import { NoBurn } from '../components/NoBurn.tsx'
import { useDreamThread } from '../components/OpenedDream.tsx'
import { PendingButton } from '../components/PendingButton.tsx'
import { Refreshing } from '../components/Refreshing.tsx'
import { joinFirst, joinLink } from '../joining.ts'
import { useAction, useLoad } from '../load.ts'
import { renderMarkdown } from '../markdown.ts'
import { rowsFor } from '../textarea.ts'
import { isAdmin, isApproved, useViewer } from '../viewer.tsx'

export type BringApi = Pick<
  ApiClient,
  | 'getBringList'
  | 'addBringItem'
  | 'updateBringItem'
  | 'deleteBringItem'
  | 'bringThis'
  | 'stopBringingThis'
  | 'getEventAttendees'
  | 'getThread'
  | 'postComment'
  | 'updateComment'
  | 'deleteComment'
  | 'uploadImage'
>

type Attendee = EventAttendeesResponse['attendees'][number]

const BLANK = { title: '', comment: '', bringing: false }

const asksNote = (items: readonly BringEntry[]) =>
  items.length === 0
    ? 'Nothing on the list yet — add the first thing below.'
    : 'Everything asked for has somebody bringing it.'

export const Bring = ({ api }: { api: BringApi }) => {
  const viewer = useViewer()
  const approved = isApproved(viewer)
  const burn = useSelectedBurn()
  const [draft, setDraft] = useState(BLANK)
  const [opened, setOpened] = useState<string | undefined>(undefined)
  const [editing, setEditing] = useState<string | undefined>(undefined)

  const { loaded, refreshing, reload } = useLoad(
    async (signal) => {
      if (burn === undefined) return { items: [], attendees: [] }

      const [list, coming] = await Promise.all([
        api.getBringList(burn.event.id, signal),
        api.getEventAttendees(burn.event.id, signal),
      ])

      return { items: list.items, attendees: coming.attendees }
    },
    {
      enabled: approved,
      key: burn?.event.id ?? '',
      fallback: 'Could not load the bring list.',
      live: true,
      remember: 'bring',
    },
  )

  const { busy, error, setError, run } = useAction(reload)

  const items = loaded.status === 'ready' ? loaded.data.items : []
  const attendees = loaded.status === 'ready' ? loaded.data.attendees : []
  const viewerId = viewer.account?.id
  const attending = attendees.some((who) => who.account_id === viewerId)

  const asked: string | undefined = useLocation().query?.[BRING_PARAM]

  useEffect(() => {
    if (asked !== undefined) setOpened(asked)
  }, [asked])

  const talk = useDreamThread({
    api,
    threadId: items.find((item) => item.id === opened)?.thread_id,
    run,
  })

  const post = () => {
    if (burn === undefined) return
    if (draft.title.trim() === '') {
      setError('Say what it is, so somebody can answer it.')
      return
    }

    run(async () => {
      await api.addBringItem(burn.event.id, {
        title: draft.title.trim(),
        comment: draft.comment.trim(),
        bringing: draft.bringing,
      })
      setDraft(BLANK)
    }, joinFirst('Could not add that.'))
  }

  const hand = (id: string, bringing: boolean, accountId: string) => {
    run(
      () => (bringing ? api.bringThis(id, { account_id: accountId }) : api.stopBringingThis(id, accountId)),
      joinFirst('Could not save that.', accountId === viewerId ? 'mine' : 'theirs'),
    )
  }

  const asks = items.filter((item) => item.hands.length === 0)
  const offers = items.filter((item) => item.hands.length > 0)

  const half = (shown: readonly BringEntry[], empty: string) =>
    shown.length === 0 ? (
      <p class="form-note">{empty}</p>
    ) : (
      <ul class="bring-list">
        {shown.map((item) => (
          <Row
            key={item.id}
            item={item}
            attendees={attendees}
            viewerId={viewerId}
            admin={isAdmin(viewer)}
            busy={busy}
            opened={opened === item.id}
            editing={editing === item.id}
            talk={talk}
            upload={api.uploadImage}
            onOpen={() => setOpened(opened === item.id ? undefined : item.id)}
            onEdit={(wanted) => setEditing(wanted ? item.id : undefined)}
            onSave={(changes) =>
              run(async () => {
                await api.updateBringItem(item.id, changes)
                setEditing(undefined)
              }, 'Could not save that.')
            }
            onWithdraw={() => run(() => api.deleteBringItem(item.id), 'Could not take that off.')}
            onHand={(bringing, accountId) => hand(item.id, bringing, accountId)}
          />
        ))}
      </ul>
    )

  return (
    <GuardedPage title="Bring list" require="approved">
      <h1>
        Bring list <Refreshing on={refreshing} />
      </h1>

      <p class="form-note">
        What the burn needs somebody to bring, and what people are already bringing. Add a thing and put your
        hand up for it — several people can bring the same thing, and nothing here is a promise anybody
        checks.
      </p>

      <ErrorText message={error} link={joinLink(error)} />

      {loaded.status === 'loading' && <p class="form-note">Loading…</p>}
      {loaded.status === 'failed' && <ErrorText message={loaded.message} />}

      {loaded.status === 'ready' && burn === undefined && (
        <NoBurn absent="there is nothing to bring anything to" />
      )}

      {loaded.status === 'ready' && burn !== undefined && (
        <>
          <section>
            <h2>Nobody is bringing these yet</h2>
            {half(asks, asksNote(items))}
          </section>

          <section>
            <h2>Somebody is bringing these</h2>
            {half(offers, 'Nobody has said they are bringing anything yet.')}
          </section>

          <form
            class="form"
            onSubmit={(submitEvent) => {
              submitEvent.preventDefault()
              post()
            }}
          >
            <h2>Add something</h2>

            <label class="field">
              <span>What is it?</span>
              <input
                type="text"
                name="title"
                maxLength={MAX_TITLE}
                aria-required
                value={draft.title}
                onInput={(typed) => setDraft((current) => ({ ...current, title: typed.currentTarget.value }))}
              />
            </label>

            <label class="field">
              <span>Anything else about it?</span>
              <textarea
                name="comment"
                maxLength={MAX_NOTES}
                rows={rowsFor(draft.comment)}
                value={draft.comment}
                onInput={(typed) =>
                  setDraft((current) => ({ ...current, comment: typed.currentTarget.value }))
                }
              />
            </label>

            {attending && (
              <label class="field-inline">
                <input
                  type="checkbox"
                  name="bringing"
                  checked={draft.bringing}
                  onChange={(ticked) =>
                    setDraft((current) => ({ ...current, bringing: ticked.currentTarget.checked }))
                  }
                />
                <span>I am bringing this myself</span>
              </label>
            )}

            <PendingButton busy={busy} label="Add it" busyLabel="Adding…" type="submit" />
          </form>
        </>
      )}
    </GuardedPage>
  )
}

const Row = ({
  item,
  attendees,
  viewerId,
  admin,
  busy,
  opened,
  editing,
  talk,
  upload,
  onOpen,
  onEdit,
  onSave,
  onWithdraw,
  onHand,
}: {
  item: BringEntry
  attendees: readonly Attendee[]
  viewerId: string | undefined
  admin: boolean
  busy: boolean
  opened: boolean
  editing: boolean
  talk: DreamTalk
  upload: UploadImage
  onOpen: () => void
  onEdit: (wanted: boolean) => void
  onSave: (changes: { title: string; comment: string }) => void
  onWithdraw: () => void
  onHand: (bringing: boolean, accountId: string) => void
}) => {
  const mine = item.author_account_id === viewerId

  if (editing) {
    return (
      <li class="bring-row">
        <ItemFields item={item} busy={busy} onCancel={() => onEdit(false)} onSave={onSave} />
      </li>
    )
  }

  return (
    <li class="bring-row">
      <p class="bring-what">
        <strong>{item.title}</strong>
      </p>

      {item.comment !== '' && (
        <div
          class="markdown-preview bring-note"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(item.comment) }}
        />
      )}

      <p class="form-note">
        Added by{' '}
        {item.author_account_id === null ? (
          'somebody who has left'
        ) : (
          <a href={profilePage(item.author_account_id)}>{item.author_name ?? 'somebody'}</a>
        )}
      </p>

      <HelperStrip
        label={`bringing ${item.title}`}
        people={item.hands}
        candidates={attendees}
        everyone={attendees}
        viewerId={viewerId}
        busy={busy}
        onAdd={(accountId) => onHand(true, accountId)}
        onRemove={(accountId) => onHand(false, accountId)}
      />

      <p class="bring-actions">
        <IconButton
          icon="comment"
          label={`${opened ? 'Hide' : 'Show'} what has been said about ${item.title}`}
          disabled={busy}
          onClick={onOpen}
        />
        {mine && (
          <IconButton icon="edit" label={`Edit ${item.title}`} disabled={busy} onClick={() => onEdit(true)} />
        )}
        {(mine || admin) && <Destroy what={item.title} verb="Take off" busy={busy} onDestroy={onWithdraw} />}
      </p>

      {opened && (
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
      )}
    </li>
  )
}

const ItemFields = ({
  item,
  busy,
  onCancel,
  onSave,
}: {
  item: BringEntry
  busy: boolean
  onCancel: () => void
  onSave: (changes: { title: string; comment: string }) => void
}) => {
  const [title, setTitle] = useState(item.title)
  const [comment, setComment] = useState(item.comment)

  return (
    <div class="bring-edit">
      <label class="field">
        <span>What is it?</span>
        <input
          type="text"
          maxLength={MAX_TITLE}
          aria-label={`Name, for ${item.title}`}
          value={title}
          onInput={(typed) => setTitle(typed.currentTarget.value)}
        />
      </label>

      <label class="field">
        <span>Anything else about it?</span>
        <textarea
          maxLength={MAX_NOTES}
          rows={rowsFor(comment)}
          aria-label={`Comment, for ${item.title}`}
          value={comment}
          onInput={(typed) => setComment(typed.currentTarget.value)}
        />
      </label>

      <p class="row">
        <PendingButton
          busy={busy}
          label="Save"
          busyLabel="Saving…"
          type="button"
          onClick={() => onSave({ title: title.trim(), comment: comment.trim() })}
        />
        <button type="button" class="link-button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </p>
    </div>
  )
}
