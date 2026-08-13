import type { ComponentChildren } from 'preact'

import { useState } from 'preact/hooks'

import { IconButton } from './IconButton.tsx'

export const Destroy = ({
  what,
  verb = 'Remove',
  because,
  trigger,
  triggerLabel,
  busy,
  onDestroy,
}: {
  what: string
  verb?: string
  because?: ComponentChildren
  trigger?: string
  triggerLabel?: string
  busy: boolean
  onDestroy: () => void
}) => {
  const [asking, setAsking] = useState(false)

  if (!asking) {
    return trigger === undefined ? (
      <IconButton icon="🗑️" label={`${verb} ${what}`} disabled={busy} onClick={() => setAsking(true)} />
    ) : (
      <button
        type="button"
        class="link-button"
        {...(triggerLabel === undefined ? {} : { 'aria-label': triggerLabel })}
        disabled={busy}
        onClick={() => setAsking(true)}
      >
        {trigger}
      </button>
    )
  }

  return (
    <>
      <span class="form-note">
        {verb} {what}?{because === undefined ? null : <> {because}</>}
      </span>
      <button
        type="button"
        disabled={busy}
        aria-label={`Really ${verb.toLowerCase()} ${what}`}
        onClick={() => {
          setAsking(false)
          onDestroy()
        }}
      >
        {verb}
      </button>
      <button type="button" class="link-button" disabled={busy} onClick={() => setAsking(false)}>
        Keep it
      </button>
    </>
  )
}
