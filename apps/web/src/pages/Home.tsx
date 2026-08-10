import type { Event } from '@sage-burner/shared'

import { BANNER_HEIGHT, BANNER_WIDTH, bannerSrc, MAX_WELCOME_LENGTH } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'
import type { Loaded } from '../load.ts'

import { FormError } from '../components/FormError.tsx'
import { IconButton } from '../components/IconButton.tsx'
import { MarkdownField } from '../components/MarkdownField.tsx'
import { PendingButton } from '../components/PendingButton.tsx'
import { TheirVersion } from '../components/TheirVersion.tsx'
import { useInstallationBanner, useInstallationTitle } from '../installation.tsx'
import { useAction, useLoad } from '../load.ts'
import { renderMarkdown } from '../markdown.ts'
import { isApproved, isMember, useViewer } from '../viewer.tsx'

type Active = Loaded<Event | null>

export type HomeApi = Pick<ApiClient, 'getActiveEvent' | 'updateWelcome'>

const Banner = ({ version }: { version?: string | null }) =>
  version === undefined || version === null ? null : (
    <img class="burn-banner" src={bannerSrc(version)} alt="" width={BANNER_WIDTH} height={BANNER_HEIGHT} />
  )

const NoOpenBurn = ({ active, title }: { active: Active; title?: string }) => {
  if (active.status === 'loading') return <p class="form-note">One moment…</p>

  if (active.status === 'failed') {
    return <p class="notice">Could not load the current burn just now. Please try again shortly.</p>
  }

  if (active.data !== null) return null

  return (
    <>
      {title !== undefined && <h1>{title}</h1>}
      {/* Before the first event exists, and again once the last has ended. Says so
          rather than showing a stale welcome text — see the active-event rule in
          `docs/burns.md`. */}
      <p class="notice">There is no burn scheduled at the moment. Check back later.</p>
    </>
  )
}

export const Home = ({ api }: { api: HomeApi }) => {
  const viewer = useViewer()
  const banner = useInstallationBanner()
  const title = useInstallationTitle()
  const [editing, setEditing] = useState<string | undefined>(undefined)
  const [opening, setOpening] = useState(false)

  const { loaded: active, reload } = useLoad(async (signal) => (await api.getActiveEvent(signal)).event, {})

  const { busy: saving, formError, setError, failure: refused, run } = useAction(reload)

  const openEvent = active.status === 'ready' ? active.data : null

  const openEditor = async (fallback: string) => {
    setError(undefined)
    setOpening(true)
    try {
      const { event } = await api.getActiveEvent()

      if (event === null) {
        void reload()
        return
      }

      setEditing(event.welcome_markdown)
    } catch {
      setEditing(fallback)
    } finally {
      setOpening(false)
    }
  }

  const save = (id: string, welcome_markdown: string) => {
    run(async () => {
      await api.updateWelcome(id, { welcome_markdown })
      setEditing(undefined)
    }, 'Could not save that. Please try again.')
  }

  return (
    <article class="prose">
      <Banner version={banner} />

      <NoOpenBurn active={active} title={title} />

      {openEvent !== null && (
        <>
          <h1>{openEvent.name}</h1>
          <p class="event-dates">
            <time dateTime={openEvent.start_date}>{openEvent.start_date}</time> –{' '}
            <time dateTime={openEvent.end_date}>{openEvent.end_date}</time>
            {openEvent.location !== '' && <> · {openEvent.location}</>}
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
                <IconButton
                  busy={opening}
                  icon="✏️"
                  busyIcon="⌛"
                  label="Edit this text"
                  onClick={() => void openEditor(openEvent.welcome_markdown)}
                />
              )}
            </>
          ) : (
            <form
              class="form"
              onSubmit={(submitEvent) => {
                submitEvent.preventDefault()
                save(openEvent.id, editing)
              }}
            >
              <MarkdownField
                label="Welcome text"
                value={editing}
                maxLength={MAX_WELCOME_LENGTH}
                onInput={setEditing}
              />

              <FormError error={formError} />
              <TheirVersion failure={refused} at={['event', 'welcome_markdown']} />

              <PendingButton busy={saving} label="Save" busyLabel="Saving…" type="submit" />
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
