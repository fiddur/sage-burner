import { MAX_TITLE } from '@sage-burner/shared'
import { useEffect, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { PushToggle } from '../components/PushToggle.tsx'
import { useSetInstallationTitle } from '../installation.tsx'
import { isAdmin, useViewer } from '../viewer.tsx'

export type AdminSettingsApi = Pick<
  ApiClient,
  'getInstallation' | 'updateInstallation' | 'getPushKey' | 'subscribeToPush' | 'unsubscribeFromPush'
>

type Loaded = { status: 'loading' } | { status: 'ready' } | { status: 'failed' }

/** What this installation calls itself. */
export const AdminSettings = ({ api }: { api: AdminSettingsApi }) => {
  const viewer = useViewer()
  const admin = isAdmin(viewer)
  const setInstallationTitle = useSetInstallationTitle()
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (!admin) return undefined

    const controller = new AbortController()

    api
      .getInstallation(controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return
        setLoaded({ status: 'ready' })
        setTitle(response.installation.title)
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoaded({ status: 'failed' })
      })

    return () => {
      controller.abort()
    }
  }, [api, admin])

  const save = async () => {
    setError(undefined)
    setSaved(false)
    if (title.trim() === '') {
      setError('Give it a name — this is the heading on every page.')
      return
    }

    setSaving(true)
    try {
      const response = await api.updateInstallation({ title: title.trim() })
      setTitle(response.installation.title)
      setInstallationTitle(response.installation.title)
      setSaved(true)
    } catch (failure) {
      setError(isApiError(failure) ? failure.message : 'Could not save that. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <GuardedPage title="Settings" require="admin">
      <h1>Settings</h1>

      {loaded.status === 'loading' && <p class="form-note">Loading…</p>}

      {loaded.status === 'failed' && (
        <p class="form-error" role="alert">
          Could not load the settings. Please reload the page.
        </p>
      )}

      {loaded.status === 'ready' && (
        <form
          class="form"
          onSubmit={(submitEvent) => {
            submitEvent.preventDefault()
            void save()
          }}
        >
          {error !== undefined && (
            <p class="form-error" role="alert">
              {error}
            </p>
          )}

          <label class="field">
            <span>What these burns are called</span>
            <input
              type="text"
              name="title"
              maxLength={MAX_TITLE}
              aria-required
              value={title}
              onInput={(inputEvent) => setTitle(inputEvent.currentTarget.value)}
            />
          </label>

          <p class="form-note">
            The heading on the homepage and the name in the header — what your people call the gathering, not
            the software running it.
          </p>

          {saved && (
            <p class="form-note" role="status">
              Saved.
            </p>
          )}

          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </form>
      )}

      <PushToggle api={api} />
    </GuardedPage>
  )
}
