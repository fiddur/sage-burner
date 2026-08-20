import type { ComponentChildren } from 'preact'

import { useEffect, useRef, useState } from 'preact/hooks'

import { joinLink } from '../joining.ts'
import { useOverlay } from '../overlay.ts'
import { ErrorText } from './ErrorText.tsx'
import { Icon } from './Icon.tsx'

export const DreamPanel = ({
  label,
  error,
  page = false,
  askBeforeClosing,
  onBack,
  onClose,
  children,
}: {
  label: string
  error: string | undefined
  page?: boolean
  askBeforeClosing?: string
  onBack?: () => void
  onClose: () => void
  children: ComponentChildren
}) => {
  const panel = useRef<HTMLDivElement>(null)
  const [asking, setAsking] = useState(false)

  const leave = () => {
    if (askBeforeClosing === undefined) {
      onClose()

      return
    }

    setAsking(true)
  }

  const dismiss = onBack ?? leave

  useOverlay(panel, !page)

  // Only the dialog takes focus. As a page there is nothing to move focus into and no trap to
  // start, and a cold arrival matched `:focus-visible` on the container — an ember ring drawn
  // around the whole page, where the card had just been taken away.
  useEffect(() => {
    if (!page) panel.current?.focus()
  }, [page])

  // Opening changes the query and not the path, so nothing does what a page arrival does: the
  // window keeps the list's scroll and `useHidingBar` keeps the bar it hid on the way down.
  useEffect(() => {
    if (!page) return

    globalThis.scrollTo({ top: 0 })
    globalThis.dispatchEvent(new Event('scroll'))
  }, [page, label])

  useEffect(() => {
    const onKey = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === 'Escape') dismiss()
    }

    document.addEventListener('keydown', onKey)

    return () => document.removeEventListener('keydown', onKey)
  }, [dismiss])

  const inside = (
    <div
      class={page ? 'dream-panel is-page' : 'dream-panel'}
      role={page ? 'region' : 'dialog'}
      aria-modal={page ? undefined : 'true'}
      aria-label={label}
      tabIndex={-1}
      ref={panel}
      onClick={(clickEvent) => clickEvent.stopPropagation()}
    >
      <p class="panel-bar">
        {asking && askBeforeClosing !== undefined && (
          <span class="panel-asking">
            <span>{askBeforeClosing}</span>
            <button type="button" onClick={onClose}>
              Throw it away
            </button>
            <button type="button" onClick={() => setAsking(false)}>
              Keep writing
            </button>
          </span>
        )}
        <button type="button" class="panel-close" aria-label={`Close ${label}`} onClick={leave}>
          <Icon name="close" />
        </button>
      </p>

      <ErrorText message={error} link={joinLink(error)} />
      {children}
    </div>
  )

  if (page) return inside

  return (
    <div class="dream-modal" onClick={dismiss}>
      {inside}
    </div>
  )
}
