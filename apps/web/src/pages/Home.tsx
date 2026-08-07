import type { Event } from '@sage-burner/shared'

import { apiRoutes, BANNER_HEIGHT, BANNER_WIDTH, MAX_WELCOME_LENGTH } from '@sage-burner/shared'
import { useEffect, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { FormError, useFormError } from '../components/FormError.tsx'
import { MarkdownField } from '../components/MarkdownField.tsx'
import { PendingButton } from '../components/PendingButton.tsx'
import { TheirVersion } from '../components/TheirVersion.tsx'
import { useInstallationBanner, useInstallationTitle } from '../installation.tsx'
import { renderMarkdown } from '../markdown.ts'
import { isApproved, isMember, useViewer } from '../viewer.tsx'

type Active = { status: 'loading' } | { status: 'ready'; event: Event | null } | { status: 'failed' }

export type HomeApi = Pick<ApiClient, 'getActiveEvent' | 'updateWelcome'>

/**
 * The picture an admin uploaded, above the burn it is a picture of (#306).
 *
 * `undefined` while the installation is still arriving and `null` when nobody has
 * uploaded one — both draw nothing, so the page does not flash a broken image at a
 * URL that would 404.
 *
 * The alt is empty deliberately: what it shows is the burn whose name follows it, and
 * nobody has been asked to describe the photograph. The dimensions are the ones the
 * browser drew it at, so the space is reserved before the bytes arrive.
 */
const Banner = ({ version }: { version?: string | null }) =>
  version === undefined || version === null ? null : (
    <img
      class="burn-banner"
      src={`${apiRoutes.getInstallationBanner.path()}?v=${encodeURIComponent(version)}`}
      alt=""
      width={BANNER_WIDTH}
      height={BANNER_HEIGHT}
    />
  )

/**
 * Everything the page says when it has no burn to show yet, and nothing when it has.
 *
 * The heading included: the burn's name is normally the `h1`, so with no burn the
 * public page had none at all (#309), and this is the one state where the
 * installation's name is not then on screen twice. Not while either answer is still
 * coming — a heading that turns into a different one is worse than a late one.
 */
const NoOpenBurn = ({ active, title }: { active: Active; title?: string }) => {
  if (active.status === 'loading') return <p class="form-note">One moment…</p>

  if (active.status === 'failed') {
    return <p class="notice">Could not load the current burn just now. Please try again shortly.</p>
  }

  if (active.event !== null) return null

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

/**
 * The public landing page.
 *
 * Almost nothing here is written by us: the banner is uploaded, and everything below
 * the burn's name comes from `welcome_markdown` on the active event, because copy that
 * lives in this file is copy an admin cannot change without a deploy — which is the
 * whole point of #11 and this page.
 *
 * The burn's name is the heading. What the installation calls itself is in the bar
 * above, on every page and beside its icon, so a second copy of it here was the same
 * words twice on the one page where the burn should lead (#306).
 *
 * Reachable signed out; `getActiveEvent` needs no session.
 */
export const Home = ({ api }: { api: HomeApi }) => {
  const viewer = useViewer()
  const banner = useInstallationBanner()
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
              {/* A pen, for the reason the meal intro's is one: a text button under a
                  paragraph, in the paragraph's own face, read as part of it. Still a
                  `PendingButton` rather than an `IconButton` — the editor opens after a
                  read, and the hourglass is what says so — so the label the emoji
                  replaces moves to `aria-label` by hand. */}
              {isApproved(viewer) && (
                <PendingButton
                  busy={opening}
                  label="✏️"
                  busyLabel="⌛"
                  type="button"
                  class="link-button"
                  aria-label="Edit this text"
                  onClick={() => void openEditor(openEvent.welcome_markdown)}
                />
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
