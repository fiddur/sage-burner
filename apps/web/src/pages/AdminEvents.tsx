import type { Event } from '@sage-burner/shared'

import { MAX_LOCATION, MAX_SLUG, MAX_TITLE, MAX_WELCOME_LENGTH } from '@sage-burner/shared'
import { useRef, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'
import type { MealSlotsApi } from '../components/MealSlots.tsx'

import { isApiError } from '../api/client.ts'
import { ErrorText } from '../components/ErrorText.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { MarkdownField } from '../components/MarkdownField.tsx'
import { MealSlots } from '../components/MealSlots.tsx'
import { PendingButton } from '../components/PendingButton.tsx'
import { stillUploading } from '../image-upload.ts'
import { useAction, useLoad } from '../load.ts'
import { isAdmin, useViewer } from '../viewer.tsx'

export type EventsApi = MealSlotsApi &
  Pick<ApiClient, 'createEvent' | 'getEvents' | 'updateEvent' | 'uploadImage'>

type Editable = Pick<
  Event,
  | 'name'
  | 'start_date'
  | 'end_date'
  | 'start_time'
  | 'end_time'
  | 'location'
  | 'member_cap'
  | 'welcome_markdown'
  | 'payment_info_markdown'
  | 'transfer_info_markdown'
>

export const changedFields = (before: Editable | undefined, now: Editable): Partial<Editable> => {
  if (before === undefined) return now

  const was = new Map(Object.entries(before))
  const changed: Partial<Editable> = {}

  for (const [key, value] of Object.entries(now)) {
    if (value !== was.get(key)) Object.assign(changed, { [key]: value })
  }

  return changed
}

const BLANK = {
  name: '',
  slug: '',
  start_date: '',
  end_date: '',
  start_time: '00:00',
  end_time: '23:59',
  location: '',
  member_cap: '42',
}

const messageFor = (failure: unknown, fallback: string) => {
  if (!isApiError(failure)) return fallback
  if (failure.status === 409) return 'That slug is already taken — pick another.'
  if (failure.status === 400) return 'Something in that form was rejected — check the dates and lengths.'
  return failure.message
}

export const AdminEvents = ({ api }: { api: EventsApi }) => {
  const viewer = useViewer()
  const admin = isAdmin(viewer)

  const [draft, setDraft] = useState(BLANK)

  const [editing, setEditing] = useState<string | undefined>(undefined)
  const editingNow = useRef<string | undefined>(undefined)
  const original = useRef<Event | undefined>(undefined)
  const [welcome, setWelcome] = useState('')
  const [payment, setPayment] = useState('')
  const [transfer, setTransfer] = useState('')
  const [details, setDetails] = useState({
    name: '',
    start_date: '',
    end_date: '',
    start_time: '',
    end_time: '',
    location: '',
    member_cap: '',
  })
  const [saved, setSaved] = useState(false)

  const { loaded: events, reload } = useLoad(async (signal) => (await api.getEvents(signal)).events, {
    enabled: admin,
    fallback: 'Could not load the events.',
  })

  const { busy: creating, error: createError, run: runCreate } = useAction(reload)
  const { busy: saving, error: saveError, setError: setSaveError, run: runSave } = useAction(reload)

  const submitNew = (submitEvent: SubmitEvent) => {
    submitEvent.preventDefault()

    runCreate(
      async () => {
        await api.createEvent({
          name: draft.name,
          slug: draft.slug,
          start_date: draft.start_date,
          end_date: draft.end_date,
          start_time: draft.start_time,
          end_time: draft.end_time,
          location: draft.location,
          welcome_markdown: '',
          payment_info_markdown: '',
          member_cap: Number(draft.member_cap),
        })
        setDraft(BLANK)
      },
      (failure) => messageFor(failure, 'Could not create the event.'),
    )
  }

  const startEditing = (row: Event) => {
    setEditing(row.id)
    editingNow.current = row.id
    original.current = row
    setWelcome(row.welcome_markdown)
    setPayment(row.payment_info_markdown)
    setTransfer(row.transfer_info_markdown)
    setDetails({
      name: row.name,
      start_date: row.start_date,
      end_date: row.end_date,
      start_time: row.start_time,
      end_time: row.end_time,
      location: row.location,
      member_cap: String(row.member_cap),
    })
    setSaveError(undefined)
    setSaved(false)
  }

  const saveEvent = (id: string) => {
    const cap = Number(details.member_cap)
    if (!Number.isInteger(cap) || cap < 1) {
      setSaveError('The member cap has to be a whole number, at least one.')
      return
    }

    setSaved(false)
    runSave(
      async () => {
        const changes = changedFields(original.current, {
          name: details.name,
          start_date: details.start_date,
          end_date: details.end_date,
          start_time: details.start_time,
          end_time: details.end_time,
          location: details.location,
          member_cap: cap,
          welcome_markdown: welcome,
          payment_info_markdown: payment,
          transfer_info_markdown: transfer,
        })

        const { event: updated } = await api.updateEvent(id, changes)

        if (editingNow.current === id) {
          original.current = updated
          setDetails({
            name: updated.name,
            start_date: updated.start_date,
            end_date: updated.end_date,
            start_time: updated.start_time,
            end_time: updated.end_time,
            location: updated.location,
            member_cap: String(updated.member_cap),
          })
          setWelcome(updated.welcome_markdown)
        }

        setSaved(true)
      },
      (failure) => messageFor(failure, 'Could not save the event.'),
    )
  }

  return (
    <GuardedPage title="Events" require="admin">
      <h1>Events</h1>

      {events.status === 'loading' && <p class="form-note">Loading…</p>}

      {events.status === 'failed' && <ErrorText message={events.message} />}

      {events.status === 'ready' && (
        <>
          {events.data.length === 0 && <p class="form-note">No events yet. Create the first one below.</p>}

          {events.data.map((row) => (
            <article key={row.id} class="event-row">
              <h2>{row.name}</h2>
              <p class="form-note">
                {row.start_date} {row.start_time} – {row.end_date} {row.end_time} · /{row.slug} · cap{' '}
                {row.member_cap}
              </p>

              <details>
                <summary>Meal times</summary>
                <MealSlots api={api} eventId={row.id} />
              </details>

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
                    <span>Where</span>
                    <input
                      type="text"
                      maxLength={MAX_LOCATION}
                      aria-label={`Location of ${row.slug}`}
                      value={details.location}
                      onInput={(inputEvent) =>
                        setDetails({ ...details, location: inputEvent.currentTarget.value })
                      }
                    />
                  </label>

                  <p class="form-note">
                    Shown on the homepage and in the card a shared link draws — "Sagegården, outside Rättvik",
                    not the directions.
                  </p>

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

                  <MarkdownField
                    label="Welcome text (markdown)"
                    value={welcome}
                    maxLength={MAX_WELCOME_LENGTH}
                    rows={12}
                    onInput={(next) => {
                      setWelcome(next)
                      setSaved(false)
                    }}
                  />

                  <MarkdownField
                    label="How to pay (markdown)"
                    value={payment}
                    maxLength={MAX_WELCOME_LENGTH}
                    rows={6}
                    upload={api.uploadImage}
                    onInput={(next) => {
                      setPayment(next)
                      setSaved(false)
                    }}
                  />

                  <MarkdownField
                    label="When the burn is full (markdown)"
                    value={transfer}
                    maxLength={MAX_WELCOME_LENGTH}
                    rows={6}
                    upload={api.uploadImage}
                    onInput={(next) => {
                      setTransfer(next)
                      setSaved(false)
                    }}
                  />

                  <ErrorText message={saveError} />
                  {saved && (
                    <p class="form-note" role="status">
                      Saved. It appears on the homepage while this is the current burn.
                    </p>
                  )}

                  <PendingButton
                    busy={saving}
                    disabled={stillUploading(payment) || stillUploading(transfer)}
                    label="Save event"
                    busyLabel="Saving…"
                    type="button"
                    onClick={() => void saveEvent(row.id)}
                  />
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
        <ErrorText message={createError} />

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
          <span>Where</span>
          <input
            type="text"
            maxLength={MAX_LOCATION}
            value={draft.location}
            onInput={(inputEvent) => setDraft({ ...draft, location: inputEvent.currentTarget.value })}
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

        <PendingButton busy={creating} label="Create event" busyLabel="Creating…" type="submit" />
      </form>
    </GuardedPage>
  )
}
