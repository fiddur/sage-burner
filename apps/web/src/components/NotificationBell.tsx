import type { Notification } from '@sage-burner/shared'

import { useLocation } from 'preact-iso'
import { useEffect, useRef, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { markFavicon } from '../favicon.ts'
import { usePhone } from '../viewport.ts'
import { NotificationList } from './NotificationList.tsx'

export type BellApi = Pick<ApiClient, 'getMyNotifications' | 'markNotificationsSeen'>

/**
 * How often to ask. The same 60s floor the version watcher uses, and for the same
 * reason: a page left open on a phone should not poll harder than it is read.
 */
const ASK_EVERY_MS = 60_000

/**
 * The bell, grey until something has happened (#248).
 *
 * Opening it marks everything seen, which is the whole of what "seen" means here —
 * there is no per-item read state, because a list of six things nobody has to tick
 * off individually does not need one.
 *
 * The list stays after it goes grey. What the bubble counts is what is *new*, not
 * what is outstanding: a notification is a thing that happened, not a task.
 *
 * **It is a link to `/notifications` that a wide viewport intercepts** (#336). One
 * control rather than two: on a phone the panel does not exist, so it cannot open
 * off-screen the way it did whenever the header wrapped and the bell stopped being
 * top-right; a tapped push lands on a real page on any device; and a middle-click or
 * an open-in-new-tab does what the underline promises. The interception is left
 * alone for a modified click for the same reason.
 */
export const NotificationBell = ({ api }: { api: BellApi }) => {
  const [items, setItems] = useState<readonly Notification[]>([])
  const [unseen, setUnseen] = useState(0)
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLSpanElement>(null)
  const bell = useRef<HTMLAnchorElement>(null)
  const phone = usePhone()
  const { path } = useLocation()

  useEffect(() => {
    const controller = new AbortController()

    const ask = () => {
      api
        .getMyNotifications(controller.signal)
        .then(({ notifications, unseen: count }) => {
          if (controller.signal.aborted) return
          setItems(notifications)
          setUnseen(count)
        })
        // Swallowed: a bell that cannot reach the server has nothing useful to say,
        // and an error where a count goes would be worse than the absence of one.
        .catch(() => undefined)
    }

    ask()
    const timer = setInterval(ask, ASK_EVERY_MS)

    return () => {
      controller.abort()
      clearInterval(timer)
    }
    // On the path as well as the client: reading `/notifications` marks everything
    // seen from there, and without this the bubble would sit on a count of nothing
    // for up to a minute afterwards.
  }, [api, path])

  // On the boolean, not the count. Keyed by `unseen`, going from one to two re-ran
  // the effect: the cleanup put the plain icon back and the new call redrew the dot
  // after a fetch and a compose, so the tab flickered undotted for no change a reader
  // would notice (#295).
  const badged = unseen > 0
  useEffect(() => markFavicon(badged), [badged])

  // A window narrowed while the panel is open would leave it hanging off a bell that
  // is no longer where it was drawn — and the page it belongs on is one tap away.
  useEffect(() => {
    if (phone) setOpen(false)
  }, [phone])

  /**
   * Anywhere else, or Escape, puts it away.
   *
   * `pointerdown` rather than `click`, so a press that begins outside closes the panel
   * even when it ends somewhere else — and so the panel is gone before whatever was
   * pressed reacts. A press inside is left alone: the bell's own toggle is one of
   * them, and closing here would fight it.
   *
   * Escape hands focus back to the bell, which is where it came from — a keyboard
   * user who dismisses the panel otherwise lands at the top of the document.
   */
  useEffect(() => {
    if (!open) return undefined

    const outside = (pointer: Event) => {
      const target = pointer.target
      if (target instanceof Node && wrap.current?.contains(target) === true) return
      setOpen(false)
    }

    const escape = (key: KeyboardEvent) => {
      if (key.key !== 'Escape') return
      setOpen(false)
      bell.current?.focus()
    }

    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)

    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  const toggle = () => {
    const opening = !open
    setOpen(opening)
    if (!opening || unseen === 0) return

    // Optimistic, and safe to be: the server is being told the same thing, and the
    // worst a failure costs is a bubble that comes back on the next ask.
    setUnseen(0)
    api
      .markNotificationsSeen()
      .then(({ notifications }) => setItems(notifications))
      .catch(() => undefined)
  }

  const follow = (click: MouseEvent) => {
    if (phone) return
    // A new tab, a new window, or the middle button: all of them mean the page rather
    // than a panel in a document the reader is about to leave behind.
    if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey || click.button !== 0) return

    click.preventDefault()
    toggle()
  }

  return (
    <span class="bell-wrap" ref={wrap}>
      <a
        ref={bell}
        href="/notifications"
        class={unseen > 0 ? 'bell has-unseen' : 'bell'}
        aria-expanded={phone ? undefined : open}
        aria-label={unseen === 0 ? 'Notifications' : `Notifications, ${unseen} new`}
        onClick={follow}
      >
        <span aria-hidden="true">🔔</span>
        {unseen > 0 && (
          <span class="bell-count" aria-hidden="true">
            {unseen}
          </span>
        )}
      </a>

      {open && (
        <div class="bell-panel">
          <NotificationList items={items} onFollow={() => setOpen(false)} />
        </div>
      )}
    </span>
  )
}
