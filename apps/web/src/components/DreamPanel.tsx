import type { ComponentChildren } from 'preact'

import { useEffect, useRef } from 'preact/hooks'

import { joinLink } from '../joining.ts'
import { useOverlay } from '../overlay.ts'
import { ErrorText } from './ErrorText.tsx'
import { Icon } from './Icon.tsx'

export const DreamPanel = ({
  label,
  error,
  onBack,
  onClose,
  children,
}: {
  label: string
  error: string | undefined
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
        onClick={(clickEvent) => clickEvent.stopPropagation()}
      >
        <p class="panel-bar">
          <button type="button" class="panel-close" aria-label={`Close ${label}`} onClick={onClose}>
            <Icon name="close" />
          </button>
        </p>

        <ErrorText message={error} link={joinLink(error)} />
        {children}
      </div>
    </div>
  )
}
