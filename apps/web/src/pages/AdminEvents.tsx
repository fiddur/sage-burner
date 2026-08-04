import type { Event } from '@sage-burner/shared'

import { MAX_SLUG, MAX_TITLE, MAX_WELCOME_LENGTH } from '@sage-burner/shared'
import { useEffect, useRef, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { renderMarkdown } from '../markdown.ts'
import { isAdmin, useViewer } from '../viewer.tsx'

type Events =
  | { status: 'loading' }
  | { status: 'ready'; events: readonly Event[] }
  | { status: 'failed'; message: string }

export type EventsApi = Pick<ApiClient, 'createEvent' | 'getEvents' | 'updateEvent'>

type Editable = Pick<
  Event,
  'name' | 'start_date' | 'end_date' | 'start_time' | 'end_time' | 'member_cap' | 'welcome_markdown'
>

/**
 * The fields that differ from the event as loaded.
 *
 * Sending the whole event means an organiser fixing the cap overwrites the
 * welcome text someone else edited in between — `eventUpdateSchema` is
 * `.partial()` precisely so that does not happen. Two organisers editing the
 * *same* field still last-writer-wins; this is only about the ones they did not
 * touch.
 */
export const changedFields = (before: Editable | undefined, now: Editable): Partial<Editable> =>
  before === undefined
    ? now
    : Object.fromEntries(
        Object.entries(now).filter(([key, value]) => value !== before[key as keyof Editable]),
      )

const BLANK = {
  name: '',
  slug: '',
  start_date: '',
  end_date: '',
  // The whole of both days, which is what the schedule assumed before the hours
  // existed. An organiser who knows the gate times narrows it.
  start_time: '00:00',
  end_time: '23:59',
  member_cap: '42',
}

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
  // Which row the form is on *now*, readable from inside an awaited save whose
  // `editing` is pinned to the row it started on.
  const editingNow = useRef<string | undefined>(undefined)
  // The row as loaded into the form, so a save can send only what differs.
  const original = useRef<Event | undefined>(undefined)
  const [welcome, setWelcome] = useState('')
  const [details, setDetails] = useState({
    name: '',
    start_date: '',
    end_date: '',
    start_time: '',
    end_time: '',
    member_cap: '',
  })
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
        <p>This is an admin page.</p>
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
        start_time: draft.start_time,
        end_time: draft.end_time,
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
    editingNow.current = row.id
    original.current = row
    setWelcome(row.welcome_markdown)
    setDetails({
      name: row.name,
      start_date: row.start_date,
      end_date: row.end_date,
      start_time: row.start_time,
      end_time: row.end_time,
      member_cap: String(row.member_cap),
    })
    setSaveError(undefined)
    setSaved(false)
  }

  const saveEvent = async (id: string) => {
    if (saving) return

    const cap = Number(details.member_cap)
    if (!Number.isInteger(cap) || cap < 1) {
      setSaveError('The member cap has to be a whole number, at least one.')
      return
    }

    setSaving(true)
    setSaveError(undefined)
    setSaved(false)
    try {
      const changes = changedFields(original.current, {
        name: details.name,
        start_date: details.start_date,
        end_date: details.end_date,
        start_time: details.start_time,
        end_time: details.end_time,
        member_cap: cap,
        welcome_markdown: welcome,
      })

      const { event: updated } = await api.updateEvent(id, changes)

      // The still-open form gets the canonical row too. Updating only the list
      // leaves the header showing what was stored and the inputs showing what was
      // typed — the same inconsistency this avoids one level down.
      //
      // Only if the form is still on this row: clicking Edit on another event
      // while a save is in flight would otherwise drop this response into that
      // form and report "Saved." under fields nobody sent.
      if (editingNow.current === id) {
        original.current = updated
        setDetails({
          name: updated.name,
          start_date: updated.start_date,
          end_date: updated.end_date,
          start_time: updated.start_time,
          end_time: updated.end_time,
          member_cap: String(updated.member_cap),
        })
        setWelcome(updated.welcome_markdown)
      }

      setEvents((current) =>
        current.status === 'ready'
          ? {
              status: 'ready',
              // The row as written, rather than the draft: the server trims and
              // may refuse part of it, and echoing the draft would show a save
              // that did not happen the way it is drawn.
              events: current.events.map((row) => (row.id === id ? updated : row)),
            }
          : current,
      )
      setSaved(true)
    } catch (failure) {
      setSaveError(messageFor(failure, 'Could not save the event.'))
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
                {row.start_date} {row.start_time} – {row.end_date} {row.end_time} · /{row.slug} · cap{' '}
                {row.member_cap}
              </p>

              {editing === row.id ? (
                <>
                  <label class="field">
                    <span>Name</span>
                    <input
                      type="text"
                      maxLength={MAX_TITLE}
                      aria-label={`Name of ${row.slug}`}
                      value={details.name}
                      onInput={(inputEvent) =>
                        setDetails({ ...details, name: inputEvent.currentTarget.value })
                      }
                    />
                  </label>

                  <label class="field">
                    <span>Starts</span>
                    <input
                      type="date"
                      aria-label={`Start date of ${row.slug}`}
                      max={details.end_date === '' ? undefined : details.end_date}
                      value={details.start_date}
                      onInput={(inputEvent) =>
                        setDetails({ ...details, start_date: inputEvent.currentTarget.value })
                      }
                    />
                  </label>

                  <label class="field">
                    <span>Starting time</span>
                    <input
                      type="time"
                      aria-label={`Start time of ${row.slug}`}
                      value={details.start_time}
                      onInput={(inputEvent) =>
                        setDetails({ ...details, start_time: inputEvent.currentTarget.value })
                      }
                    />
                  </label>

                  <label class="field">
                    <span>Ends</span>
                    <input
                      type="date"
                      aria-label={`End date of ${row.slug}`}
                      min={details.start_date === '' ? undefined : details.start_date}
                      value={details.end_date}
                      onInput={(inputEvent) =>
                        setDetails({ ...details, end_date: inputEvent.currentTarget.value })
                      }
                    />
                  </label>

                  <label class="field">
                    <span>Ending time</span>
                    <input
                      type="time"
                      aria-label={`End time of ${row.slug}`}
                      value={details.end_time}
                      onInput={(inputEvent) =>
                        setDetails({ ...details, end_time: inputEvent.currentTarget.value })
                      }
                    />
                  </label>

                  <label class="field">
                    <span>Member cap</span>
                    <input
                      type="number"
                      min="1"
                      aria-label={`Member cap of ${row.slug}`}
                      value={details.member_cap}
                      onInput={(inputEvent) =>
                        setDetails({ ...details, member_cap: inputEvent.currentTarget.value })
                      }
                    />
                  </label>

                  <label class="field">
                    <span>Welcome text (markdown)</span>
                    <textarea
                      rows={12}
                      maxLength={MAX_WELCOME_LENGTH}
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
                      Saved. It appears on the homepage while this is the current burn.
                    </p>
                  )}

                  <button type="button" disabled={saving} onClick={() => void saveEvent(row.id)}>
                    {saving ? 'Saving…' : 'Save event'}
                  </button>
                  <button type="button" class="link-button" onClick={() => setEditing(undefined)}>
                    Done
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => startEditing(row)}>
                  Edit event
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
            maxLength={MAX_TITLE}
            value={draft.name}
            onInput={(inputEvent) => setDraft({ ...draft, name: inputEvent.currentTarget.value })}
          />
        </label>

        <label class="field">
          <span>Slug</span>
          <input
            required
            maxLength={MAX_SLUG}
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
            // Bound to its partner, so the picker will not offer a burn that ends
            // before it starts. The schema and the CHECK still decide it.
            max={draft.end_date === '' ? undefined : draft.end_date}
            value={draft.start_date}
            onInput={(inputEvent) => setDraft({ ...draft, start_date: inputEvent.currentTarget.value })}
          />
        </label>

        <label class="field">
          <span>Starting time</span>
          <input
            type="time"
            required
            aria-label="Starting time"
            value={draft.start_time}
            onInput={(inputEvent) => setDraft({ ...draft, start_time: inputEvent.currentTarget.value })}
          />
        </label>

        <label class="field">
          <span>Ends</span>
          <input
            type="date"
            required
            min={draft.start_date === '' ? undefined : draft.start_date}
            value={draft.end_date}
            onInput={(inputEvent) => setDraft({ ...draft, end_date: inputEvent.currentTarget.value })}
          />
        </label>

        <label class="field">
          <span>Ending time</span>
          <input
            type="time"
            required
            aria-label="Ending time"
            value={draft.end_time}
            onInput={(inputEvent) => setDraft({ ...draft, end_time: inputEvent.currentTarget.value })}
          />
        </label>

        <p class="form-note">
          The schedule runs between these, so a burn that opens at midday and closes at midday is two half
          days of grid rather than three whole ones.
        </p>

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
