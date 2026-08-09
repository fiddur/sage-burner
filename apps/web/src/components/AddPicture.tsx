import type { ImageUpload } from '../image-upload.ts'

import { ErrorText } from './ErrorText.tsx'

/**
 * Choosing a picture for a markdown field, for where pasting is not the way in (#379).
 *
 * A phone has no clipboard full of screenshots and no window to drag from, so this is
 * how a photograph gets into a comment there. It writes at the end of the field rather
 * than at the cursor: opening the picker takes the focus off the textarea, and a
 * remembered offset would be a guess by the time anything comes back.
 */
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
              // Cleared, so the same file can be chosen again after a failure — without
              // this a retry of the identical picture fires no change event.
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
