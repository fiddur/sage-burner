import type { ImageUpload } from '../image-upload.ts'

import { ErrorText } from './ErrorText.tsx'
import { Icon } from './Icon.tsx'

export const AddPicture = ({ pictures, label }: { pictures: ImageUpload; label: string }) => {
  if (!pictures.enabled) return null

  return (
    <label class="syntax-button add-picture" title="Add a picture">
      <Icon name="picture" />
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
  )
}

export const PictureTrouble = ({ pictures }: { pictures: ImageUpload }) => (
  <>
    {pictures.busy && <p class="form-note">Sending a picture…</p>}
    <ErrorText message={pictures.error} />
  </>
)
