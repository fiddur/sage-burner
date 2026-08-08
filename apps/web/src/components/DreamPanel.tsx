import type { ComponentChildren } from 'preact'

import { useEffect, useRef } from 'preact/hooks'

import { useOverlay } from '../overlay.ts'
import { ErrorText } from './ErrorText.tsx'

/**
 * The panel the grid opens over itself — for reading a dream, editing one, or
 * offering one.
 *
 * Not a `<dialog>`: `showModal` is an imperative call on a ref, so what is showing
 * would be a second thing to keep in step with the caller's own open state.
 * `role="dialog"` with `aria-modal` says the same to a screen reader, and what
 * `showModal` would have brought along is `useOverlay`.
 */
export const DreamPanel = ({
  label,
  error,
  onBack,
  onClose,
  children,
}: {
  label: string
  /** Shown here rather than on the page, which renders under the overlay. */
  error: string | undefined
  /**
   * A step to take before closing, if there is one — Escape and the backdrop take it
   * instead (#207).
   *
   * The form inside is what this is for: #205 stopped a *refused write* discarding
   * what somebody had typed. Escape still discards a draft — the first press runs
   * `onCancelEdit`, which unmounts the form — but it no longer closes the panel with
   * it, so the dream is still open to edit again. Without a step to go back to the
   * first press closes: reading a dream and pressing Escape is the common case, and a
   * press that did nothing would be worse than the thing being guarded.
   */
  onBack?: () => void
  onClose: () => void
  children: ComponentChildren
}) => {
  const panel = useRef<HTMLDivElement>(null)
  const dismiss = onBack ?? onClose

  useOverlay(panel)

  useEffect(() => {
    panel.current?.focus()
  }, [])

  // On the document rather than on the panel. Clicking anything in here disables it
  // for the length of the write, and a disabled button drops focus to `<body>` — so
  // a handler waiting for the key to bubble up from inside stopped hearing it after
  // the first thing you did.
  useEffect(() => {
    const onKey = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === 'Escape') dismiss()
    }

    document.addEventListener('keydown', onKey)

    return () => document.removeEventListener('keydown', onKey)
  }, [dismiss])

  return (
    <div class="dream-modal" onClick={dismiss}>
      <div
        class="dream-panel"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        ref={panel}
        // Reading the description must not close the thing you opened to read it.
        onClick={(clickEvent) => clickEvent.stopPropagation()}
      >
        <ErrorText message={error} />
        {children}
      </div>
    </div>
  )
}
