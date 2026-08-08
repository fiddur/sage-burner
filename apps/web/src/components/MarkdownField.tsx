import { useId, useState } from 'preact/hooks'

import { renderMarkdown } from '../markdown.ts'
import { rowsFor } from '../textarea.ts'

/**
 * Every markdown field in the app.
 *
 * Two `aria-pressed` buttons rather than `role="tab"`: a tab promises a
 * controlled `tabpanel`, a name pointing back at the tab, and roving focus with
 * arrow keys. This is a pair of toggles, and claiming the tab contract without
 * meeting it tells a screen reader something untrue.
 */
export const MarkdownField = ({
  label,
  value,
  maxLength,
  rows,
  accessibleName,
  placeholder,
  onInput,
}: {
  label: string
  value: string
  maxLength: number
  /**
   * How tall the box opens when there is nothing in it. A floor rather than a size:
   * a field seeded with a page of text opens as a page whatever this says (#338).
   */
  rows?: number
  /** For where the visible label is friendlier than it is specific. */
  accessibleName?: string
  placeholder?: string
  onInput: (value: string) => void
}) => {
  const [previewing, setPreviewing] = useState(false)
  const fieldId = useId()

  return (
    <div class="field">
      {/* No `for` while previewing: the textarea is unmounted, and `for` must
          name a labelable element in the same tree. It degrades to plain text,
          which is what it was before. */}
      <label for={previewing ? undefined : fieldId}>{label}</label>

      <div class="md-field">
        <div class="md-field-tabs">
          <button
            type="button"
            aria-pressed={!previewing}
            // Named per field: a page with two markdown fields has two "Preview"
            // buttons, and "Preview" alone says nothing about which.
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
              <div
                class="markdown-preview"
                // Safe by construction: `renderMarkdown` escapes raw HTML rather
                // than filtering it, and checks link and image URLs against an
                // allowlist. `markdown.ts` says why escaping beats a sanitiser here.
                dangerouslySetInnerHTML={{ __html: renderMarkdown(value) }}
              />
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
          />
        )}
      </div>
    </div>
  )
}
