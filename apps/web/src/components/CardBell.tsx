import type { NotificationCategory } from '@sage-burner/shared'

import { notificationCategoryInfo } from '@sage-burner/shared'
import { useEffect, useId, useRef, useState } from 'preact/hooks'

export const CardBell = ({
  what,
  category,
  on,
  following,
  busy,
  onToggle,
  onFollow,
}: {
  what: string
  category: NotificationCategory | undefined
  on: boolean
  following: boolean
  busy: boolean
  onToggle: () => void
  onFollow: (following: boolean) => void
}) => {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return undefined

    const away = (event: Event) => {
      if (!(event.target instanceof Node) || wrap.current?.contains(event.target) !== true) setOpen(false)
    }
    const escape = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', escape)

    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  return (
    <div ref={wrap} class="card-bell">
      <button
        type="button"
        class="card-bell-button"
        aria-label={`Notification settings for ${what}`}
        aria-controls={panelId}
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <span aria-hidden="true">{on || following ? '🔔' : '🔕'}</span>
      </button>

      {open && (
        <div
          id={panelId}
          class="card-bell-menu"
          role="group"
          aria-label={`Notification settings for ${what}`}
        >
          <p class="card-bell-title">Notification settings</p>

          <label class="tick">
            <input
              type="checkbox"
              checked={following}
              disabled={busy}
              onChange={() => onFollow(!following)}
            />
            <span>Notify on replies</span>
          </label>

          {category !== undefined && (
            <label class="tick">
              <input type="checkbox" checked={on} disabled={busy} onChange={onToggle} />
              <span>Notify me on similar ({notificationCategoryInfo[category].label})</span>
            </label>
          )}
        </div>
      )}
    </div>
  )
}
