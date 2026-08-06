import { useId, useState } from 'preact/hooks'

import { renderMarkdown } from '../markdown.ts'

/**
 * A markdown textarea with a Write and a Preview view.
 *
 * Help text carries things like the 10+1 principles someone has to agree to, so
 * it needs lists and paragraphs rather than one long line.
 *
 * Two `aria-pressed` buttons rather than `role="tab"`: a tab promises a
 * controlled `tabpanel`, a name pointing back at the tab, and roving focus with
 * arrow keys. This is a pair of toggles, and claiming the tab contract without
 * meeting it tells a screen reader something untrue. Aurboda's version — which
 * this now looks like — uses plain buttons with no state at all; the look is
 * worth copying and that part is not.
 *
 * **Every markdown field in the app is this component.** The dream description
 * and the welcome text each had their own bare textarea, so two of the five
 * places a member writes markdown offered no way to see what it would look like.
 */
export const MarkdownField = ({
  label,
  value,
  maxLength,
  rows,
  describedAs,
  placeholder,
  onInput,
}: {
  label: string
  value: string
  maxLength: number
  rows?: number
  /**
   * The textarea's accessible name, when the visible label is not specific
   * enough on its own — "Tell people about it" is friendlier on the page than
   * "Description of the sauna sharing", and a screen reader needs the latter.
   */
  describedAs?: string
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
            class={previewing ? 'md-field-tab' : 'md-field-tab is-current'}
            onClick={() => setPreviewing(false)}
          >
            Write
          </button>
          <button
            type="button"
            aria-pressed={previewing}
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
            rows={rows}
            aria-label={describedAs}
            placeholder={placeholder}
            value={value}
            onInput={(inputEvent) => onInput(inputEvent.currentTarget.value)}
          />
        )}
      </div>
    </div>
  )
}
