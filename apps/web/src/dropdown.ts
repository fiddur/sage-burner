import type { RefObject } from 'preact'

import { useEffect, useRef } from 'preact/hooks'

export const useAway = <T extends HTMLElement>(open: boolean, close: () => void): RefObject<T> => {
  const wrap = useRef<T>(null)
  const latest = useRef(close)
  latest.current = close

  useEffect(() => {
    if (!open) return undefined

    const away = (event: Event) => {
      if (!(event.target instanceof Node) || wrap.current?.contains(event.target) !== true) {
        latest.current()
      }
    }
    const escape = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === 'Escape') latest.current()
    }

    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', escape)

    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  return wrap
}
