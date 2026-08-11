import type { ImageUpload } from '../image-upload.ts'

import { ErrorText } from './ErrorText.tsx'

export const AddPicture = ({ pictures, label }: { pictures: ImageUpload; label: string }) => {
  if (!pictures.enabled) return null

  return (
    <>
      {/* A `div`, not a `p`: `ErrorText` is a paragraph and one mount point is a row wrapper. */}
      <div class="row">
        <label class="link-button add-picture">
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
