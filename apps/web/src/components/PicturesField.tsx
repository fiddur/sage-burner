import { apiRoutes, MAX_IMAGES_PER_ACCOUNT } from '@sage-burner/shared'

import type { ApiClient } from '../api/client.ts'

import { useAction, useLoad } from '../load.ts'
import { ErrorText } from './ErrorText.tsx'
import { FormError } from './FormError.tsx'
import { IconButton } from './IconButton.tsx'

export type PicturesApi = Pick<ApiClient, 'getMyImages' | 'removeMyImage'>

const stored = (iso: string) => new Date(iso).toLocaleDateString()

export const PicturesField = ({ api }: { api: PicturesApi }) => {
  const { loaded, reload } = useLoad(async (signal) => (await api.getMyImages(signal)).images, {
    fallback: 'Could not load your pictures. Please reload the page.',
  })
  const images = loaded.status === 'ready' ? loaded.data : undefined

  const { busy, busyWith, formError, run } = useAction(reload)

  return (
    <section>
      <h2>Pictures you have added</h2>

      <p class="form-note">
        Every picture you paste or drop into something you write is kept here, whether or not what you wrote
        still shows it. You may hold {MAX_IMAGES_PER_ACCOUNT}. Taking one off frees a place — and leaves a gap
        wherever it was still being shown, which nothing here can tell you.
      </p>

      {loaded.status === 'loading' && <p class="form-note">Loading…</p>}

      {loaded.status === 'failed' && <ErrorText message={loaded.message} />}

      {images?.length === 0 && <p class="form-note">You have not added any yet.</p>}

      {images !== undefined && images.length > 0 && (
        <>
          <p class="form-note">
            {images.length} of {MAX_IMAGES_PER_ACCOUNT}
          </p>

          <ul class="picture-grid">
            {images.map((picture, at) => (
              <li key={picture.id}>
                {/* No alt text to give: what a picture is of lives in prose nothing here can find. */}
                <img src={apiRoutes.storedImage.path(picture.id)} alt="" loading="lazy" />
                <span class="form-note">{stored(picture.created_at)}</span>
                <IconButton
                  icon="✕"
                  label={`Take off picture ${at + 1} of ${images.length}, added ${stored(picture.created_at)}`}
                  disabled={busy}
                  busy={busyWith === picture.id}
                  onClick={() => {
                    run(
                      async () => {
                        await api.removeMyImage(picture.id)
                      },
                      'Could not take that picture off. Please try again.',
                      picture.id,
                    )
                  }}
                />
              </li>
            ))}
          </ul>
        </>
      )}

      <FormError error={formError} />
    </section>
  )
}
