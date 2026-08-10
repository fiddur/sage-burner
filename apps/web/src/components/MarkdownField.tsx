import { useId, useState } from 'preact/hooks'

import type { UploadImage } from '../image-upload.ts'

import { useImageUpload } from '../image-upload.ts'
import { renderMarkdown } from '../markdown.ts'
import { rowsFor } from '../textarea.ts'
import { AddPicture } from './AddPicture.tsx'

export const MarkdownField = ({
  label,
  value,
  maxLength,
  rows,
  accessibleName,
  placeholder,
  upload,
  onInput,
}: {
  label: string
  value: string
  maxLength: number
  rows?: number
  accessibleName?: string
  placeholder?: string
  upload?: UploadImage
  onInput: (value: string) => void
}) => {
  const [previewing, setPreviewing] = useState(false)
  const fieldId = useId()
  const pictures = useImageUpload({ value, maxLength, onInput, upload })

  return (
    <div class="field">
      {/* No `for` while previewing: the textarea it would name is unmounted. */}
      <label for={previewing ? undefined : fieldId}>{label}</label>

      <div class="md-field">
        <div class="md-field-tabs">
          <button
            type="button"
            aria-pressed={!previewing}
            aria-label={`Write ${label}`}
            class={previewing ? 'md-field-tab' : 'md-field-tab is-current'}
            onClick={() => setPreviewing(false)}
          >
            Write
          </button>
          <button
            type="button"
            aria-pressed={previewing}
            aria-label={`Preview ${label}`}
            class={previewing ? 'md-field-tab is-current' : 'md-field-tab'}
            onClick={() => setPreviewing(true)}
          >
            Preview
          </button>
        </div>

        {previewing ? (
          <div class="md-field-body">
            {value.trim() === '' ? (
              <p class="form-note">Nothing to preview yet.</p>
            ) : (
              <div class="markdown-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(value) }} />
            )}
          </div>
        ) : (
          <textarea
            id={fieldId}
            class="md-field-write"
            maxLength={maxLength}
            rows={rowsFor(value, rows)}
            aria-label={accessibleName}
            placeholder={placeholder}
            value={value}
            onInput={(inputEvent) => onInput(inputEvent.currentTarget.value)}
            {...pictures.handlers}
          />
        )}
      </div>

      {!previewing && <AddPicture pictures={pictures} label={label} />}
    </div>
  )
}
