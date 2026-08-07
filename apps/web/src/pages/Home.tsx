import type { Event } from '@sage-burner/shared'

import { MAX_WELCOME_LENGTH } from '@sage-burner/shared'
import { useEffect, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { FormError, useFormError } from '../components/FormError.tsx'
import { MarkdownField } from '../components/MarkdownField.tsx'
import { TheirVersion } from '../components/TheirVersion.tsx'
import { useInstallationTitle } from '../installation.tsx'
import { renderMarkdown } from '../markdown.ts'
import { isApproved, isMember, useViewer } from '../viewer.tsx'

type Active = { status: 'loading' } | { status: 'ready'; event: Event | null } | { status: 'failed' }

export type HomeApi = Pick<ApiClient, 'getActiveEvent' | 'updateWelcome'>

/**
 * The public landing page.
 *
 * Almost nothing here is written by us. Everything below the title comes from
 * `welcome_markdown` on the active event, because copy that lives in this file
 * is copy an admin cannot change without a deploy — which is the whole
 * point of #11 and this page.
 *
 * Reachable signed out; `getActiveEvent` needs no session.
 */
export const Home = ({ api }: { api: HomeApi }) => {
  const viewer = useViewer()
  const title = useInstallationTitle()
  const [active, setActive] = useState<Active>({ status: 'loading' })
  const [editing, setEditing] = useState<string | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useFormError()
  const [refused, setRefused] = useState<unknown>(undefined)

  useEffect(() => {
    const controller = new AbortController()

    api
      .getActiveEvent(controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) setActive({ status: 'ready', event: response.event })
      })
      .catch(() => {
        // No code, no detail. A visitor who cannot reach the API can do nothing
        // with the reason, and this is also what an offline first paint looks
        // like — an error banner would be worse than "come back later".
        if (!controller.signal.aborted) setActive({ status: 'failed' })
      })

    return () => {
      controller.abort()
    }
  }, [api])

  const openEvent = active.status === 'ready' ? active.event : null

  /**
   * Open the editor on the text as it is now, not as it was when the page loaded.
   *
   * `PATCH …/welcome` overwrites the whole field, so a homepage left open for an
   * hour and then edited would discard whatever was written in between. Re-reading
   * here shrinks that window from "since the page loaded" to "since Edit was
   * pressed", which for a field forty-odd people share is the difference that
   * matters. What closes it is the `If-Match` the save carries (#274): this read is
   * where the version it quotes comes from, so an edit landing after it is refused
   * rather than overwritten.
   *
   * A failed re-read falls back to what is on screen: refusing to open the editor
   * because the network hiccuped would be the worse answer.
   *
   * The window it leaves — between pressing Edit and pressing Save — is closed by
   * `If-Match` (#274) rather than by this: the save quotes the version this read
   * handed over, and a burn edited in between is refused with what it now says.
   */
  const openEditor = async (fallback: string) => {
    setError(undefined)
    setRefused(undefined)
    // Said out loud, because the re-read is a round trip with nothing else
    // changing on screen. Without it this is a button that appears to do nothing
    // for as long as the network takes — the symptom `FormError` exists for,
    // reintroduced by the fix for the stale draft.
    setOpening(true)
    try {
      const { event } = await api.getActiveEvent()

      // No active burn means the last one ended while this page sat open. Opening
      // the editor would write to a burn nobody is looking at any more — and the
      // save would put it back on screen as though it were still open. The page
      // falls into its no-burn state instead, which is the whole section
      // disappearing and so is its own explanation.
      if (event === null) {
        setActive({ status: 'ready', event: null })
        return
      }

      setActive({ status: 'ready', event })
      setEditing(event.welcome_markdown)
    } catch {
      setEditing(fallback)
    } finally {
      setOpening(false)
    }
  }

  const save = async (id: string, welcome_markdown: string) => {
    setSaving(true)
    setError(undefined)
    setRefused(undefined)
    try {
      const { event } = await api.updateWelcome(id, { welcome_markdown })
      setActive({ status: 'ready', event })
      setEditing(undefined)
    } catch (failure) {
      setError(isApiError(failure) ? failure.message : 'Could not save that. Please try again.')
      // The editor stays open with what was typed still in it. A paragraph somebody
      // wrote is not something to throw away because somebody else saved first —
      // `TheirVersion` puts the other one beside it to be reconciled against.
      setRefused(failure)
    } finally {
      setSaving(false)
    }
  }

  return (
    <article class="prose">
      <h1>{title}</h1>

      {active.status === 'loading' && <p class="form-note">One moment…</p>}

      {active.status === 'failed' && (
        <p class="notice">Could not load the current burn just now. Please try again shortly.</p>
      )}

      {active.status === 'ready' &&
        active.event === null && (
          // Before the first event exists, and again once the last has ended.
          // Says so rather than showing a stale welcome text — see the
          // active-event rule in `docs/burns.md`.
          <p class="notice">There is no burn scheduled at the moment. Check back later.</p>
        )}

      {openEvent !== null && (
        <>
          <h2>{openEvent.name}</h2>
          <p class="event-dates">
            <time dateTime={openEvent.start_date}>{openEvent.start_date}</time> –{' '}
            <time dateTime={openEvent.end_date}>{openEvent.end_date}</time>
          </p>

          {/*
            Rendered to everyone, and written by any approved member. `renderMarkdown`
            escapes raw HTML rather than filtering it, and checks link and image URLs
            against a scheme allowlist — `markdown.ts` says why escaping is the safer
            of the two, and why that holds for an author who is not an admin.
          */}
          {editing === undefined ? (
            <>
              <div
                class="welcome"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(openEvent.welcome_markdown) }}
              />

              {/*
                Edited where it is read: whoever spots a typo on the homepage is the
                one likely to fix it. The burn's dates and cap stay admin-only and
                are edited under Organise, which is why this is not a link to there.
              */}
              {isApproved(viewer) && (
                <button
                  type="button"
                  class="link-button"
                  disabled={opening}
                  onClick={() => void openEditor(openEvent.welcome_markdown)}
                >
                  {opening ? 'Opening…' : 'Edit this text'}
                </button>
              )}
            </>
          ) : (
            <form
              class="form"
              onSubmit={(submitEvent) => {
                submitEvent.preventDefault()
                void save(openEvent.id, editing)
              }}
            >
              <MarkdownField
                label="Welcome text"
                value={editing}
                maxLength={MAX_WELCOME_LENGTH}
                onInput={setEditing}
              />

              <FormError error={error} />
              <TheirVersion failure={refused} at={['event', 'welcome_markdown']} />

              <button type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                class="link-button"
                disabled={saving}
                onClick={() => setEditing(undefined)}
              >
                Cancel
              </button>
            </form>
          )}
        </>
      )}

      <p class="home-actions">
        {/*
          Applying is the point of the page, so the link does not wait for the
          *event* to load — someone who arrived to apply should not sit through
          that round trip first. It does wait for the viewer, which is a
          different request and already in flight before this mounts: `isMember`
          is false while the viewer is `loading`, so without this gate a member
          would be shown "Apply to join" for the length of `getMe` and then watch
          it vanish — a layout shift, and an invitation to apply to something
          they are already in. `Layout` gates its public entry points the same
          way, for the same reason.
        */}
        {viewer.status !== 'loading' && !isMember(viewer) && (
          <a class="button" href="/apply">
            Apply to join
          </a>
        )}
        {viewer.status === 'signed-out' && <a href="/login">Log in</a>}
      </p>
    </article>
  )
}
