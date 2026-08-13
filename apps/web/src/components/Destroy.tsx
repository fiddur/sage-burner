import type { ComponentChildren } from 'preact'

import { useState } from 'preact/hooks'

import { IconButton } from './IconButton.tsx'

/**
 * The one control for anything that cannot be undone by pressing it again. It was four hand-rolled
 * copies and twenty-eight controls with nothing at all, so whether a thing asked was decided by
 * which call site was written last — which is how a meeting was lost. Something recoverable by the
 * same press is not destructive and must not use this: a confirmation on everything is a
 * confirmation on nothing.
 */
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
