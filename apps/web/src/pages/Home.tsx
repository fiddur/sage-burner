import type { Event } from '@sage-burner/shared'

import { useEffect, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { FormError, useFormError } from '../components/FormError.tsx'
import { MarkdownField } from '../components/MarkdownField.tsx'
import { useInstallationTitle } from '../installation.tsx'
import { renderMarkdown } from '../markdown.ts'
import { isApproved, isMember, useViewer } from '../viewer.tsx'

const MAX_WELCOME = 100_000

type Active = { status: 'loading' } | { status: 'ready'; event: Event | null } | { status: 'failed' }

export type HomeApi = Pick<ApiClient, 'getActiveEvent' | 'updateWelcome'>

/**
 * The public landing page.
 *
 * Almost nothing here is written by us. Everything below the title comes from
 * `welcome_markdown` on the active event, because copy that lives in this file
 * is copy an organiser cannot change without a deploy — which is the whole
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
  const [error, setError] = useFormError()

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

  // Bound once so the editor's callbacks do not each re-narrow `active`.
  const current = active.status === 'ready' ? active.event : null

  const save = async (id: string, welcome_markdown: string) => {
    setSaving(true)
    setError(undefined)
    try {
      const { event } = await api.updateWelcome(id, { welcome_markdown })
      setActive({ status: 'ready', event })
      setEditing(undefined)
    } catch (failure) {
      setError(isApiError(failure) ? failure.message : 'Could not save that. Please try again.')
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
          // active-event rule in the README.
          <p class="notice">There is no burn scheduled at the moment. Check back later.</p>
        )}

      {active.status === 'ready' && active.event !== null && (
        <>
          <h2>{active.event.name}</h2>
          <p class="event-dates">
            <time dateTime={active.event.start_date}>{active.event.start_date}</time> –{' '}
            <time dateTime={active.event.end_date}>{active.event.end_date}</time>
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
                dangerouslySetInnerHTML={{ __html: renderMarkdown(active.event.welcome_markdown) }}
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
                  onClick={() => setEditing(current === null ? '' : current.welcome_markdown)}
                >
                  Edit this text
                </button>
              )}
            </>
          ) : (
            <form
              class="form"
              onSubmit={(submitEvent) => {
                submitEvent.preventDefault()
                if (current !== null) void save(current.id, editing)
              }}
            >
              <MarkdownField
                label="Welcome text"
                value={editing}
                maxLength={MAX_WELCOME}
                onInput={setEditing}
              />

              <FormError error={error} />

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
