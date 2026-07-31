import { useState } from 'preact/hooks'

import { renderMarkdown } from '../markdown.ts'

/**
 * A markdown textarea with Write and Preview tabs.
 *
 * Help text carries things like the 10+1 principles someone has to agree to, so
 * it needs lists and paragraphs rather than one long line — it was a
 * 2000-character single-line `<input>`, which made writing them impossible.
 *
 * Tabs rather than the always-on preview `AdminEvents` uses: this sits inside a
 * form with several other fields, and a permanent second copy of one of them
 * pushes the rest off the screen.
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

  return (
    <div class="field">
      <span>{label}</span>

      <div class="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={!previewing}
          class={previewing ? 'link-button' : 'link-button tab-current'}
          onClick={() => setPreviewing(false)}
        >
          Write
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={previewing}
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
          aria-label={label}
          maxLength={maxLength}
          value={value}
          onInput={(inputEvent) => onInput(inputEvent.currentTarget.value)}
        />
      )}
    </div>
  )
}
