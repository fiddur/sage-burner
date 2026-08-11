import { useId } from 'preact/hooks'

import type { UploadImage } from '../image-upload.ts'
import type { Mentionable } from '../mentioning.ts'

import { useImageUpload } from '../image-upload.ts'
import { renderMarkdown } from '../markdown.ts'
import { useMentioning } from '../mentioning.ts'
import { hasMarkdown } from '../syntax.ts'
import { rowsFor } from '../textarea.ts'
import { AddPicture } from './AddPicture.tsx'
import { MentionMenu } from './MentionMenu.tsx'
import { SyntaxToolbar, useSyntax } from './SyntaxToolbar.tsx'

export const MarkdownField = ({
  label,
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
  const pictures = useImageUpload({ value, maxLength, onInput, upload })
  const syntax = useSyntax({ value, maxLength, onInput })

  return (
    <div class="field">
      <label for={fieldId}>{label}</label>

      <div class="md-field">
        <SyntaxToolbar syntax={syntax} subject={accessibleName ?? label} />

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

      <MentionMenu
        candidates={mentioning.candidates}
        subject={accessibleName ?? label}
        onChoose={mentioning.choose}
      />

      <AddPicture pictures={pictures} label={label} />

      {hasMarkdown(value) && (
        <div class="md-field-preview">
          <span class="form-note">How it will read</span>
          <div class="markdown-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(value) }} />
        </div>
      )}
    </div>
  )
}
