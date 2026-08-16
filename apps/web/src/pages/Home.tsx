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
import { stillUploading } from '../image-upload.ts'
import { useInstallationBanner, useInstallationTitle } from '../installation.tsx'
import { useAction, useLoad } from '../load.ts'
import { renderMarkdown } from '../markdown.ts'
import { isApproved, isMember, useViewer } from '../viewer.tsx'

type Active = Loaded<Event | null>

export type HomeApi = Pick<ApiClient, 'getActiveEvent' | 'updateWelcome' | 'uploadImage'>

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

          {editing === undefined ? (
            <>
              <div
                class="welcome"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(openEvent.welcome_markdown) }}
              />

              {isApproved(viewer) && (
                <IconButton
                  busy={opening}
                  icon="edit"
                  busyIcon="waiting"
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
                upload={api.uploadImage}
                onInput={setEditing}
              />

              <FormError error={formError} />
              <TheirVersion failure={refused} at={['event', 'welcome_markdown']} />

              <PendingButton
                busy={saving}
                disabled={stillUploading(editing)}
                label="Save"
                busyLabel="Saving…"
                type="submit"
              />
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
