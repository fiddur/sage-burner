import type { Notification } from '@sage-burner/shared'

import { localDay } from '../datetime.ts'

export const NotificationList = ({
  items,
  onFollow,
}: {
  items: readonly Notification[]
  onFollow?: () => void
}) => {
  if (items.length === 0) return <p class="form-note">Nothing yet.</p>

  return (
    <ul class="notification-list">
      {items.map((item) => (
        <li key={item.id} class={item.seen_at === null ? 'is-new' : undefined}>
          {item.link === null ? (
            <span>{item.body}</span>
          ) : (
            <a href={item.link} onClick={onFollow}>
              {item.body}
            </a>
          )}
          <p class="notification-when">{localDay(item.created_at)}</p>
        </li>
      ))}
    </ul>
  )
}
