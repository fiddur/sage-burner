import { formattingPage } from '@sage-burner/shared'
import { useId, useState } from 'preact/hooks'

import type { UploadImage } from '../image-upload.ts'
import type { Mentionable } from '../mentioning.ts'

import { useImageUpload } from '../image-upload.ts'
import { renderMarkdown } from '../markdown.ts'
import { useMentioning } from '../mentioning.ts'
import { rowsFor } from '../textarea.ts'
import { AddPicture, PictureTrouble } from './AddPicture.tsx'
import { MentionMenu } from './MentionMenu.tsx'
import { SyntaxToolbar, useSyntax } from './SyntaxToolbar.tsx'

export const MarkdownField = ({
  label,
  labelHidden = false,
  value,
  maxLength,
  rows,
  accessibleName,
  placeholder,
  upload,
  people,
  onInput,
}: {
  label: string
  labelHidden?: boolean
  value: string
  maxLength: number
  rows?: number
  accessibleName?: string
  placeholder?: string
  upload?: UploadImage
  people?: readonly Mentionable[]
  onInput: (value: string) => void
}) => {
  const mentioning = useMentioning({ value, people, maxLength, onInput })
  const fieldId = useId()
  const writeId = useId()
  const readId = useId()
  const pictures = useImageUpload({ value, maxLength, onInput, upload })
  const syntax = useSyntax({ value, maxLength, onInput })
  const [previewing, setPreviewing] = useState(false)

  const subject = accessibleName ?? label

  return (
    <div class="field">
      <label for={fieldId} class={labelHidden ? 'visually-hidden' : undefined}>
        {label}
      </label>

      <div class="md-field">
        <div
          class="md-tabs"
          role="tablist"
          aria-label="Write or preview"
          onKeyDown={(keyEvent) => {
            if (keyEvent.key !== 'ArrowLeft' && keyEvent.key !== 'ArrowRight') return

            keyEvent.preventDefault()
            setPreviewing(keyEvent.key === 'ArrowRight')
          }}
        >
          {[false, true].map((wanted) => (
            <button
              key={wanted ? 'preview' : 'write'}
              type="button"
              role="tab"
              class={previewing === wanted ? 'md-tab is-on' : 'md-tab'}
              aria-selected={previewing === wanted}
              aria-controls={wanted ? readId : writeId}
              tabIndex={previewing === wanted ? undefined : -1}
              onClick={() => setPreviewing(wanted)}
            >
              {wanted ? 'Preview' : 'Write'}
            </button>
          ))}
        </div>

        {previewing ? (
          <div id={readId} class="md-field-preview" role="tabpanel" aria-label={`${subject}, as it reads`}>
            {value.trim() === '' ? (
              <p class="form-note">Nothing written yet.</p>
            ) : (
              /* `renderMarkdown` escapes raw HTML rather than filtering it, which is what makes this safe. */
              <div class="markdown-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(value) }} />
            )}
          </div>
        ) : (
          <div id={writeId} role="tabpanel" aria-label={`${subject}, to write in`}>
            <SyntaxToolbar syntax={syntax} subject={subject}>
              <AddPicture pictures={pictures} label={label} />
            </SyntaxToolbar>

            <textarea
              id={fieldId}
              class="md-field-write"
              ref={syntax.ref}
              maxLength={maxLength}
              rows={rowsFor(value, rows)}
              aria-label={accessibleName}
              placeholder={placeholder}
              value={value}
              onInput={(inputEvent) => onInput(inputEvent.currentTarget.value)}
              {...syntax.handlers}
              {...pictures.handlers}
              {...mentioning.noticing}
            />
          </div>
        )}
      </div>

      <MentionMenu candidates={mentioning.candidates} subject={subject} onChoose={mentioning.choose} />

      <PictureTrouble pictures={pictures} />

      <p class="form-note md-field-help">
        <a href={formattingPage()}>Markdown is supported</a>
        {pictures.enabled && ' · paste, drop or click 🖼 to add a picture'}
      </p>
    </div>
  )
}
