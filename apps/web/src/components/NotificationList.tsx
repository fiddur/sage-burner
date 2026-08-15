import type { Notification, NotificationCategory } from '@sage-burner/shared'

import { notificationCategoryInfo } from '@sage-burner/shared'
import { useId, useState } from 'preact/hooks'

import { localDay } from '../datetime.ts'
import { useAway } from '../dropdown.ts'
import { Icon } from './Icon.tsx'

const RowMenu = ({
  item,
  busy,
  onStop,
  onRemove,
}: {
  item: Notification
  busy: boolean
  onStop: (category: NotificationCategory) => void
  onRemove: (id: string) => void
}) => {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const wrap = useAway<HTMLDivElement>(open, () => setOpen(false))
  const said = item.body

  return (
    <div ref={wrap} class="notification-menu">
      <button
        type="button"
        class="notification-menu-button"
        aria-label={`What to do with “${said}”`}
        aria-controls={panelId}
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <Icon name="more" />
      </button>

      {open && (
        <div id={panelId} class="card-bell-menu" role="group" aria-label={`What to do with “${said}”`}>
          <button
            type="button"
            class="link-button"
            disabled={busy}
            onClick={() => {
              setOpen(false)
              onStop(item.category)
            }}
          >
            Stop telling me about this ({notificationCategoryInfo[item.category].label})
          </button>

          <button
            type="button"
            class="link-button"
            disabled={busy}
            onClick={() => {
              setOpen(false)
              onRemove(item.id)
            }}
          >
            Remove this notification
          </button>
        </div>
      )}
    </div>
  )
}

export const NotificationList = ({
  items,
  busy,
  onFollow,
  onStop,
  onRemove,
}: {
  items: readonly Notification[]
  busy: boolean
  onFollow?: () => void
  onStop: (category: NotificationCategory) => void
  onRemove: (id: string) => void
}) => {
  if (items.length === 0) return <p class="form-note">Nothing yet.</p>

  return (
    <ul class="notification-list">
      {items.map((item) => (
        <li key={item.id} class={item.seen_at === null ? 'is-new' : undefined}>
          <div class="notification-said">
            {item.link === null ? (
              <span>{item.body}</span>
            ) : (
              <a href={item.link} onClick={onFollow}>
                {item.body}
              </a>
            )}
            <p class="notification-when">{localDay(item.created_at)}</p>
          </div>

          <RowMenu item={item} busy={busy} onStop={onStop} onRemove={onRemove} />
        </li>
      ))}
    </ul>
  )
}
