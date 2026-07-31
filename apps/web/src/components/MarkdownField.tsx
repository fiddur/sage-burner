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
 * meeting it tells a screen reader something untrue.
 */
export const MarkdownField = ({
  label,
  value,
  maxLength,
  onInput,
}: {
  label: string
  value: string
  maxLength: number
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

      <div class="tabs">
        <button
          type="button"
          aria-pressed={!previewing}
          class={previewing ? 'link-button' : 'link-button tab-current'}
          onClick={() => setPreviewing(false)}
        >
          Write
        </button>
        <button
          type="button"
          aria-pressed={previewing}
          class={previewing ? 'link-button tab-current' : 'link-button'}
          onClick={() => setPreviewing(true)}
        >
          Preview
        </button>
      </div>

      {previewing ? (
        value.trim() === '' ? (
          <p class="form-note">Nothing to preview yet.</p>
        ) : (
          <div
            class="markdown-preview"
            // Safe by construction: `renderMarkdown` escapes raw HTML rather
            // than filtering it, and checks link and image URLs against an
            // allowlist. `markdown.ts` says why escaping beats a sanitiser here.
            dangerouslySetInnerHTML={{ __html: renderMarkdown(value) }}
          />
        )
      ) : (
        <textarea
          id={fieldId}
          maxLength={maxLength}
          value={value}
          onInput={(inputEvent) => onInput(inputEvent.currentTarget.value)}
        />
      )}
    </div>
  )
}
