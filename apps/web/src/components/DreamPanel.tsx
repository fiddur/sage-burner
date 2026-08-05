import type { ComponentChildren } from 'preact'

import { useEffect, useRef } from 'preact/hooks'

/**
 * The panel the grid opens over itself — for reading a dream, editing one, or
 * offering one.
 *
 * Not a `<dialog>`: `showModal` is an imperative call on a ref, and the focus trap
 * it brings is then a second thing to keep in step with the caller's own open
 * state. `role="dialog"` with `aria-modal` says the same to a screen reader.
 */
export const DreamPanel = ({
  label,
  onClose,
  children,
}: {
  label: string
  onClose: () => void
  children: ComponentChildren
}) => {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    panel.current?.focus()
  }, [])

  // On the document rather than on the panel. Clicking anything in here disables it
  // for the length of the write, and a disabled button drops focus to `<body>` — so
  // a handler waiting for the key to bubble up from inside stopped hearing it after
  // the first thing you did.
  useEffect(() => {
    const onKey = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', onKey)

    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div class="dream-modal" onClick={onClose}>
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
        {children}
      </div>
    </div>
  )
}
