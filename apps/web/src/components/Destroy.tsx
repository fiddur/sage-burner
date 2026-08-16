import type { ComponentChildren } from 'preact'

import { useId, useLayoutEffect, useRef, useState } from 'preact/hooks'

import { IconButton } from './IconButton.tsx'

export const Destroy = ({
  what,
  verb = 'Remove',
  because,
  trigger,
  triggerLabel,
  busy,
  working = false,
  onDestroy,
}: {
  what: string
  verb?: string
  because?: ComponentChildren
  trigger?: string
  triggerLabel?: string
  busy: boolean
  working?: boolean
  onDestroy: () => void
}) => {
  const [asking, setAsking] = useState(false)
  const questionId = useId()
  const confirm = useRef<HTMLButtonElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const moved = useRef(false)

  useLayoutEffect(() => {
    if (!moved.current) {
      moved.current = true
      return
    }

    if (asking) confirm.current?.focus()
    else opener.current?.focus({ preventScroll: true })
  }, [asking])

  if (!asking) {
    return trigger === undefined ? (
      <IconButton
        buttonRef={opener}
        icon="destroy"
        label={`${verb} ${what}`}
        busy={working}
        disabled={busy}
        onClick={() => setAsking(true)}
      />
    ) : (
      <button
        ref={opener}
        type="button"
        class="link-button"
        {...(triggerLabel === undefined ? {} : { 'aria-label': triggerLabel })}
        aria-busy={working}
        disabled={busy || working}
        onClick={() => setAsking(true)}
      >
        {trigger}
      </button>
    )
  }

  return (
    <>
      <span class="form-note" id={questionId}>
        {verb} {what}?{because === undefined ? null : <> {because}</>}
      </span>
      <button
        ref={confirm}
        type="button"
        disabled={busy}
        aria-label={`Really ${verb.toLowerCase()} ${what}`}
        aria-describedby={questionId}
        onClick={() => {
          setAsking(false)
          onDestroy()
        }}
      >
        {verb}
      </button>
      <button
        type="button"
        class="link-button"
        disabled={busy}
        aria-describedby={questionId}
        onClick={() => setAsking(false)}
      >
        Keep it
      </button>
    </>
  )
}
