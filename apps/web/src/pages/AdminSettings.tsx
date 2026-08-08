import { MAX_TITLE } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'
import type { BannerApi } from '../components/BannerField.tsx'
import type { IconApi } from '../components/IconField.tsx'
import type { MailApi } from '../components/MailField.tsx'
import type { PushApi } from '../components/PushToggle.tsx'

import { BannerField } from '../components/BannerField.tsx'
import { ErrorText } from '../components/ErrorText.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { IconField } from '../components/IconField.tsx'
import { LogOutButton } from '../components/LogOutButton.tsx'
import { MailField } from '../components/MailField.tsx'
import { PendingButton } from '../components/PendingButton.tsx'
import { PushToggle } from '../components/PushToggle.tsx'
import { useSetInstallationTitle } from '../installation.tsx'
import { useAction, useLoadInto } from '../load.ts'
import { isAdmin, useViewer } from '../viewer.tsx'

export type AdminSettingsApi = BannerApi &
  IconApi &
  MailApi &
  PushApi &
  Pick<ApiClient, 'getInstallation' | 'logout' | 'updateInstallation'>

/** What this installation calls itself. */
export const AdminSettings = ({ api }: { api: AdminSettingsApi }) => {
  const viewer = useViewer()
  const admin = isAdmin(viewer)
  const setInstallationTitle = useSetInstallationTitle()
  const [title, setTitle] = useState('')
  const [saved, setSaved] = useState(false)

  const { loaded } = useLoadInto(
    async (signal) => await api.getInstallation(signal),
    ({ installation }) => setTitle(installation.title),
    { enabled: admin, fallback: 'Could not load the settings. Please reload the page.' },
  )

  const { busy: saving, error, setError, run } = useAction()

  const save = () => {
    setSaved(false)
    if (title.trim() === '') {
      setError('Give it a name — this is the heading on every page.')
      return
    }

    run(async () => {
      const { installation } = await api.updateInstallation({ title: title.trim() })
      setTitle(installation.title)
      // The bar reads the title from a context rather than from this page, so the
      // heading everywhere else follows without a reload.
      setInstallationTitle(installation.title)
      setSaved(true)
    }, 'Could not save that. Please try again.')
  }

  return (
    <GuardedPage title="Settings" require="admin">
      <h1>Settings</h1>

      {loaded.status === 'loading' && <p class="form-note">Loading…</p>}

      {loaded.status === 'failed' && <ErrorText message={loaded.message} />}

      {loaded.status === 'ready' && (
        <form
          class="form"
          onSubmit={(submitEvent) => {
            submitEvent.preventDefault()
            save()
          }}
        >
          <ErrorText message={error} />

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

          <PendingButton busy={saving} label="Save" busyLabel="Saving…" type="submit" />
        </form>
      )}

      {/* Outside the form: they save on choosing a file rather than on submit, and a
          file input inside a form that posts a title would be two ways to save one
          page. */}
      {loaded.status === 'ready' && <IconField api={api} />}
      {loaded.status === 'ready' && <BannerField api={api} />}
      {loaded.status === 'ready' && <MailField api={api} />}

      {/* Also on the details page, which is where a member finds it. Kept here for
          the same reason ⚙️ keeps the Places and lodging links: an admin holding
          `admin` without `member` is refused from that page, and application
          notifications go precisely to admins. */}
      <PushToggle api={api} />

      <LogOutButton api={api} />
    </GuardedPage>
  )
}
