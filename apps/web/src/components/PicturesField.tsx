import { apiRoutes, MAX_IMAGES_PER_ACCOUNT } from '@sage-burner/shared'

import type { ApiClient } from '../api/client.ts'

import { useAction, useLoad } from '../load.ts'
import { ErrorText } from './ErrorText.tsx'
import { FormError } from './FormError.tsx'
import { IconButton } from './IconButton.tsx'

export type PicturesApi = Pick<ApiClient, 'getMyImages' | 'removeMyImage'>

const stored = (iso: string) => new Date(iso).toLocaleDateString()

/**
 * The pictures this account has stored, and taking one back off (#392).
 *
 * It exists because `MAX_IMAGES_PER_ACCOUNT` counts every row ever written and nothing
 * else freed one — deleting the comment that referenced a picture deliberately leaves the
 * row — so an account that reached the ceiling could never upload again by any action the
 * app offered. A cap has to be recoverable from.
 *
 * **A removal is not undone by editing the comment back.** The reference lives in prose
 * that no foreign key can see, so nothing here can say which of these is still being shown
 * somewhere; the note says so, because that is a decision the person has to make rather
 * than one this can make for them.
 */
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
                {/* No alt text to give: what a picture is of lives in the prose that
                    references it, which nothing here can find. Decorative, and the date
                    beside it is what a screen reader has to work with. */}
                <img src={apiRoutes.storedImage.path(picture.id)} alt="" loading="lazy" />
                <span class="form-note">{stored(picture.created_at)}</span>
                <IconButton
                  icon="✕"
                  // Its position, not its date: a paste session stores several on one day,
                  // and every ✕ then has the same name — which is what a screen reader
                  // reads as one control repeated.
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
