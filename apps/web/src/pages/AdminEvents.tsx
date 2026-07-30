import type { Event } from '@sage-burner/shared'

import { useEffect, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'
import type { QuestionsApi } from '../components/QuestionEditor.tsx'

import { isApiError } from '../api/client.ts'
import { QuestionEditor } from '../components/QuestionEditor.tsx'
import { renderMarkdown } from '../markdown.ts'
import { isAdmin, useViewer } from '../viewer.tsx'

type Events =
  | { status: 'loading' }
  | { status: 'ready'; events: readonly Event[] }
  | { status: 'failed'; message: string }

export type EventsApi = Pick<ApiClient, 'createEvent' | 'getEvents' | 'updateEvent'> & QuestionsApi

const BLANK = { name: '', slug: '', start_date: '', end_date: '', member_cap: '42' }

const messageFor = (failure: unknown, fallback: string) => {
  if (!isApiError(failure)) return fallback
  if (failure.status === 409) return 'That slug is already taken — pick another.'
  // Not "check the dates". A 400 is also a name over 200 characters or a slug
  // over 64, and the error envelope carries no field detail, so anything more
  // specific than this is a guess that will sometimes point at the wrong field.
  // The `maxlength` attributes below stop the browser sending those at all,
  // which is the fix that actually helps.
  if (failure.status === 400) return 'Something in that form was rejected — check the dates and lengths.'
  return failure.message
}

/**
 * Create events and edit their welcome text.
 *
 * The welcome text gets a live preview because it is markdown written in a
 * textarea, and the alternative is publishing to the homepage to find out what
 * a heading looks like. The preview runs the same `renderMarkdown` the public
 * page will, so what it shows is what visitors get.
 */
export const AdminEvents = ({ api }: { api: EventsApi }) => {
  const viewer = useViewer()
  const admin = isAdmin(viewer)

  const [events, setEvents] = useState<Events>({ status: 'loading' })
  const [draft, setDraft] = useState(BLANK)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | undefined>(undefined)

  const [editing, setEditing] = useState<string | undefined>(undefined)
  const [welcome, setWelcome] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | undefined>(undefined)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!admin) return undefined

    const controller = new AbortController()
    api
      .getEvents(controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) setEvents({ status: 'ready', events: response.events })
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return
        setEvents({ status: 'failed', message: messageFor(failure, 'Could not load the events.') })
      })

    return () => {
      controller.abort()
    }
  }, [api, admin])

  if (viewer.status === 'loading') {
    return (
      <section class="page">
        <h1>Events</h1>
        <p class="form-note">One moment…</p>
      </section>
    )
  }

  if (!admin) {
    return (
      <section class="page">
        <h1>Events</h1>
        <p>This area is for organisers.</p>
      </section>
    )
  }

  const submitNew = async (submitEvent: SubmitEvent) => {
    submitEvent.preventDefault()
    if (creating) return

    setCreating(true)
    setCreateError(undefined)
    try {
      const created = await api.createEvent({
        name: draft.name,
        slug: draft.slug,
        start_date: draft.start_date,
        end_date: draft.end_date,
        welcome_markdown: '',
        member_cap: Number(draft.member_cap),
      })
      // Inserted in start-date order rather than appended, because that is how
      // `GET /api/admin/events` returns them — appending shows a winter event
      // above a summer one until the next reload.
      setEvents((current) =>
        current.status === 'ready'
          ? {
              status: 'ready',
              events: [...current.events, created.event].sort((a, b) =>
                a.start_date.localeCompare(b.start_date),
              ),
            }
          : current,
      )
      setDraft(BLANK)
    } catch (failure) {
      setCreateError(messageFor(failure, 'Could not create the event.'))
    } finally {
      setCreating(false)
    }
  }

  const startEditing = (row: Event) => {
    setEditing(row.id)
    setWelcome(row.welcome_markdown)
    setSaveError(undefined)
    setSaved(false)
  }

  const saveWelcome = async (id: string) => {
    if (saving) return

    setSaving(true)
    setSaveError(undefined)
    setSaved(false)
    try {
      await api.updateEvent(id, { welcome_markdown: welcome })
      setEvents((current) =>
        current.status === 'ready'
          ? {
              status: 'ready',
              events: current.events.map((row) =>
                row.id === id ? { ...row, welcome_markdown: welcome } : row,
              ),
            }
          : current,
      )
      setSaved(true)
    } catch (failure) {
      setSaveError(messageFor(failure, 'Could not save the welcome text.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section class="page">
      <h1>Events</h1>

      {events.status === 'loading' && <p class="form-note">Loading…</p>}

      {events.status === 'failed' && (
        <p class="form-error" role="alert">
          {events.message}
        </p>
      )}

      {events.status === 'ready' && (
        <>
          {events.events.length === 0 && <p class="form-note">No events yet. Create the first one below.</p>}

          {events.events.map((row) => (
            <article key={row.id} class="event-row">
              <h2>{row.name}</h2>
              <p class="form-note">
                {row.start_date} – {row.end_date} · /{row.slug} · cap {row.member_cap}
              </p>

              {editing === row.id ? (
                <>
                  <label class="field">
                    <span>Welcome text (markdown)</span>
                    <textarea
                      rows={12}
                      value={welcome}
                      onInput={(inputEvent) => {
                        setWelcome(inputEvent.currentTarget.value)
                        setSaved(false)
                      }}
                    />
                  </label>

                  <h3>Preview</h3>
                  {/*
                    The same renderer the public page uses, so this is what a
                    visitor sees. Raw HTML is escaped rather than filtered —
                    see `markdown.ts` for why that is the safer of the two.
                  */}
                  <div
                    class="markdown-preview"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(welcome) }}
                  />

                  {saveError !== undefined && (
                    <p class="form-error" role="alert">
                      {saveError}
                    </p>
                  )}
                  {saved && (
                    <p class="form-note" role="status">
                      Saved. It appears on the homepage once that page is built (#13).
                    </p>
                  )}

                  <button type="button" disabled={saving} onClick={() => void saveWelcome(row.id)}>
                    {saving ? 'Saving…' : 'Save welcome text'}
                  </button>
                  <button type="button" class="link-button" onClick={() => setEditing(undefined)}>
                    Done
                  </button>

                  <QuestionEditor api={api} eventId={row.id} />
                </>
              ) : (
                <button type="button" onClick={() => startEditing(row)}>
                  Edit welcome text
                </button>
              )}
            </article>
          ))}
        </>
      )}

      <h2>New event</h2>
      <form class="form" onSubmit={(submitEvent) => void submitNew(submitEvent)}>
        {createError !== undefined && (
          <p class="form-error" role="alert">
            {createError}
          </p>
        )}

        <label class="field">
          <span>Name</span>
          <input
            required
            maxLength={200}
            value={draft.name}
            onInput={(inputEvent) => setDraft({ ...draft, name: inputEvent.currentTarget.value })}
          />
        </label>

        <label class="field">
          <span>Slug</span>
          <input
            required
            maxLength={64}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            value={draft.slug}
            onInput={(inputEvent) => setDraft({ ...draft, slug: inputEvent.currentTarget.value })}
          />
        </label>

        <label class="field">
          <span>Starts</span>
          <input
            type="date"
            required
            value={draft.start_date}
            onInput={(inputEvent) => setDraft({ ...draft, start_date: inputEvent.currentTarget.value })}
          />
        </label>

        <label class="field">
          <span>Ends</span>
          <input
            type="date"
            required
            value={draft.end_date}
            onInput={(inputEvent) => setDraft({ ...draft, end_date: inputEvent.currentTarget.value })}
          />
        </label>

        <label class="field">
          <span>Member cap</span>
          <input
            type="number"
            min="1"
            required
            value={draft.member_cap}
            onInput={(inputEvent) => setDraft({ ...draft, member_cap: inputEvent.currentTarget.value })}
          />
        </label>

        <button type="submit" disabled={creating}>
          {creating ? 'Creating…' : 'Create event'}
        </button>
      </form>
    </section>
  )
}
