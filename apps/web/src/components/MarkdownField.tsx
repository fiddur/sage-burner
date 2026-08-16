import { formattingPage } from '@sage-burner/shared'
import { useId, useRef, useState } from 'preact/hooks'

import type { UploadImage } from '../image-upload.ts'
import type { Mentionable } from '../mentioning.ts'

import { useImageUpload } from '../image-upload.ts'
import { renderMarkdown } from '../markdown.ts'
import { useMentioning } from '../mentioning.ts'
import { rowsFor } from '../textarea.ts'
import { AddPicture, PictureTrouble } from './AddPicture.tsx'
import { Icon } from './Icon.tsx'
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
  const panelId = useId()
  const pictures = useImageUpload({ value, maxLength, onInput, upload })
  const syntax = useSyntax({ value, maxLength, onInput })
  const [previewing, setPreviewing] = useState(false)
  const tabs = useRef<(HTMLButtonElement | null)[]>([null, null])

  const subject = accessibleName ?? label

  const goTo = (wanted: boolean) => {
    setPreviewing(wanted)
    tabs.current[wanted ? 1 : 0]?.focus()
  }

  return (
    <div class="field">
      {!labelHidden && <label {...(previewing ? {} : { for: fieldId })}>{label}</label>}

      <div class="md-field">
        <div
          class="md-tabs"
          role="tablist"
          aria-label="Write or preview"
          onKeyDown={(keyEvent) => {
            if (keyEvent.key !== 'ArrowLeft' && keyEvent.key !== 'ArrowRight') return

            keyEvent.preventDefault()
            goTo(keyEvent.key === 'ArrowRight')
          }}
        >
          {[false, true].map((wanted, at) => (
            <button
              key={wanted ? 'preview' : 'write'}
              ref={(node) => {
                tabs.current[at] = node
              }}
              type="button"
              role="tab"
              class={previewing === wanted ? 'md-tab is-on' : 'md-tab'}
              aria-selected={previewing === wanted}
              aria-controls={previewing === wanted ? panelId : undefined}
              tabIndex={previewing === wanted ? undefined : -1}
              onClick={() => setPreviewing(wanted)}
            >
              {wanted ? 'Preview' : 'Write'}
            </button>
          ))}
        </div>

        {previewing ? (
          <div
            id={panelId}
            class="md-field-preview"
            role="tabpanel"
            tabIndex={0}
            aria-label={`${subject}, as it reads`}
          >
            {value.trim() === '' ? (
              <p class="form-note">Nothing written yet.</p>
            ) : (
              /* `renderMarkdown` escapes raw HTML rather than filtering it, which is what makes this safe. */
              <div class="markdown-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(value) }} />
            )}
          </div>
        ) : (
          <div id={panelId} role="tabpanel">
            <SyntaxToolbar syntax={syntax} subject={subject}>
              <AddPicture pictures={pictures} label={subject} />
            </SyntaxToolbar>

            <textarea
              id={fieldId}
              class="md-field-write"
              ref={syntax.ref}
              maxLength={maxLength}
              rows={rowsFor(value, rows)}
              aria-label={labelHidden ? subject : accessibleName}
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

      {!previewing && (
        <MentionMenu candidates={mentioning.candidates} subject={subject} onChoose={mentioning.choose} />
      )}

      <PictureTrouble pictures={pictures} />

      <p class="form-note md-field-help">
        <a href={formattingPage()} target="_blank" rel="noreferrer">
          Markdown is supported
        </a>
        {pictures.enabled && (
          <>
            {' · paste, drop or click '}
            <Icon name="picture" />
            <span class="visually-hidden">the picture button</span>
            {' to add a picture'}
          </>
        )}
      </p>
    </div>
  )
}
