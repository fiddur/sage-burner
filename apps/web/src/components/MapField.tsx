import { isProfileUrl, MAX_MAP_URL } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { useAction, useLoadInto } from '../load.ts'
import { ErrorText } from './ErrorText.tsx'
import { PendingButton } from './PendingButton.tsx'

export type MapApi = Pick<ApiClient, 'getMapLink' | 'setMapLink'>

export const MapField = ({ api }: { api: MapApi }) => {
  const [url, setUrl] = useState('')
  const [saved, setSaved] = useState(false)

  const { loaded } = useLoadInto(
    async (signal) => (await api.getMapLink(signal)).map.url,
    (stored) => setUrl(stored ?? ''),
    { fallback: 'Could not load the map link.' },
  )

  const { busy, error, run } = useAction()

  const typed = url.trim()
  const linkable = typed === '' || isProfileUrl(typed)

  const save = () => {
    if (!linkable) return

    setSaved(false)
    run(async () => {
      const { map } = await api.setMapLink({ url: typed === '' ? null : typed })
      setUrl(map.url ?? '')
      setSaved(true)
    }, 'Could not save that. Please try again.')
  }

  if (loaded.status === 'failed') return <ErrorText message={loaded.message} />
  if (loaded.status === 'loading') return null

  return (
    <form
      class="form"
      onSubmit={(submitEvent) => {
        submitEvent.preventDefault()
        save()
      }}
    >
      <ErrorText message={error} />

      <label class="field">
        <span>Map of the area</span>
        <input
          type="url"
          name="map_url"
          placeholder="https://maps.app.goo.gl/…"
          maxLength={MAX_MAP_URL}
          value={url}
          onInput={(inputEvent) => setUrl(inputEvent.currentTarget.value)}
        />
      </label>

      <p class="form-note">
        A link to whatever map of the site you already keep — everybody signed in gets it in the menu, and it
        opens where it lives. Leave it empty and the entry is not there at all.
      </p>

      {!linkable && (
        <p class="form-note">A map link has to start with https:// — the server refuses anything else.</p>
      )}

      {saved && (
        <p class="form-note" role="status">
          Saved.
        </p>
      )}

      <PendingButton
        busy={busy}
        label="Save the map link"
        busyLabel="Saving…"
        type="submit"
        disabled={!linkable}
      />
    </form>
  )
}
