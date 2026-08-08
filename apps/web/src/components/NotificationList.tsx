import type { Notification } from '@sage-burner/shared'

import { localDay } from '../datetime.ts'

/**
 * What has happened, newest first — the bell's panel and the page behind it (#336).
 *
 * One component for both, so the peek and the page cannot come to say different things
 * about the same row. A notification with no page of its own is plain text: a link
 * that goes nowhere is worse than a sentence.
 *
 * `onFollow` is the panel's: following a link from a popdown has to put it away, and
 * the page has nothing to put away.
 */
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
