import type { ImageUpload } from '../image-upload.ts'

import { ErrorText } from './ErrorText.tsx'

export const AddPicture = ({ pictures, label }: { pictures: ImageUpload; label: string }) => {
  if (!pictures.enabled) return null

  return (
    <>
      {/* A `div`, not a `p`: `ErrorText` renders a paragraph of its own, and one of the
          places this is mounted is itself a row wrapper. A paragraph inside a paragraph
          is invalid markup that Preact builds anyway, so nothing here would show it. */}
      <div class="row">
        <label class="link-button">
          Add a picture
          <input
            type="file"
            class="visually-hidden"
            accept="image/*"
            multiple
            aria-label={`Add a picture to ${label}`}
            disabled={pictures.busy}
            onChange={(changeEvent) => {
              const chosen = [...(changeEvent.currentTarget.files ?? [])]
              changeEvent.currentTarget.value = ''
              pictures.take(chosen)
            }}
          />
        </label>

        {pictures.busy && <span class="form-note">Sending…</span>}
      </div>

      <ErrorText message={pictures.error} />
    </>
  )
}
