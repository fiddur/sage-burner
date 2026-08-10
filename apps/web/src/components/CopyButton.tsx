import { useState } from 'preact/hooks'

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
