import { useState } from 'preact/hooks'

/**
 * Copy a string, and claim so only when it worked.
 *
 * `writeText` rejects on a denied permission or an unfocused document, and
 * `navigator.clipboard` is undefined entirely on a non-secure origin. A false
 * "Copied" is how somebody loses what they were copying, so the caller shows the
 * text beside this and leaves it selectable by hand.
 */
export const CopyButton = ({ value, label }: { value: string; label: string }) => {
  const [copied, setCopied] = useState(false)

  return (
    <button
      type="button"
      class="link-button"
      onClick={() => {
        navigator.clipboard?.writeText(value).then(
          () => setCopied(true),
          () => undefined,
        )
      }}
    >
      {copied ? 'Copied' : label}
    </button>
  )
}
