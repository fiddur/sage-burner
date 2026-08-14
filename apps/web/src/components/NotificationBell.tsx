import type { Notification } from '@sage-burner/shared'

import { useLocation } from 'preact-iso'
import { useEffect, useRef, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { markFavicon } from '../favicon.ts'
import { useShown } from '../shown.tsx'
import { usePhone } from '../viewport.ts'
import { Icon } from './Icon.tsx'
import { NotificationList } from './NotificationList.tsx'

export type BellApi = Pick<ApiClient, 'getMyNotifications' | 'markNotificationsSeen'>

const ASK_EVERY_MS = 60_000

export const NotificationBell = ({ api }: { api: BellApi }) => {
  const [items, setItems] = useState<readonly Notification[]>([])
  const [unseen, setUnseen] = useState(0)
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLSpanElement>(null)
  const bell = useRef<HTMLAnchorElement>(null)
  const phone = usePhone()
  const shown = useShown()
  const { path } = useLocation()

  useEffect(
    () =>
      shown.subscribe(({ notifications, unseen: count }) => {
        setItems(notifications)
        setUnseen(count)
      }),
    [shown],
  )

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
        .catch(() => undefined)
    }

    ask()
    const timer = setInterval(ask, ASK_EVERY_MS)

    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [api, path])

  const badged = unseen > 0
  useEffect(() => markFavicon(badged), [badged])

  useEffect(() => {
    if (phone) setOpen(false)
  }, [phone])

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

    setUnseen(0)
    api
      .markNotificationsSeen()
      .then(({ notifications }) => setItems(notifications))
      .catch(() => undefined)
  }

  const follow = (click: MouseEvent) => {
    if (phone) return
    if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return

    click.preventDefault()
    click.stopPropagation()
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
        <Icon name="bell" />
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
