import type { RefObject } from 'preact'

import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'

export type Dismissal = 'away' | 'escape'

export const useAway = <T extends HTMLElement>(
  open: boolean,
  close: (why: Dismissal) => void,
): RefObject<T> => {
  const wrap = useRef<T>(null)
  const latest = useRef(close)
  latest.current = close

  useEffect(() => {
    if (!open) return undefined

    const away = (event: Event) => {
      if (!(event.target instanceof Node) || wrap.current?.contains(event.target) !== true) {
        latest.current('away')
      }
    }
    const escape = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== 'Escape') return

      keyEvent.stopPropagation()
      latest.current('escape')
    }

    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', escape, true)

    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', escape, true)
    }
  }, [open])

  return wrap
}

/**
 * A dropdown hangs below what opened it unless that puts it somewhere nobody can reach and
 * above would hold the whole of it. Room to spare is not the test: overflow past the bottom of
 * a scroller can be scrolled to and overflow past its top cannot, so a side that merely has
 * more of the menu on screen is worse than the side that can be reached at all.
 */
export const flipsUp = (menu: number, above: number, below: number): boolean => menu > below && above >= menu

const clipping = (from: HTMLElement): HTMLElement | undefined => {
  for (let node = from.parentElement; node !== null; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'hidden') return node
  }

  return undefined
}

/**
 * Where the panel this hangs in scrolls, its own `overflow` is what the menu is drawn outside of
 * (#699) — so the edge to measure against is that ancestor's, not the window's.
 */
export const useFlipUp = <T extends HTMLElement>(open: boolean): { menu: RefObject<T>; up: boolean } => {
  const menu = useRef<T>(null)
  const [up, setUp] = useState(false)

  useLayoutEffect(() => {
    if (!open) {
      setUp(false)
      return
    }

    const drawn = menu.current
    const anchor = drawn?.parentElement
    if (drawn == null || anchor == null) return

    const within = clipping(drawn)
    const edge = within?.getBoundingClientRect()
    const top = edge?.top ?? 0
    const bottom = edge?.bottom ?? window.innerHeight
    const box = anchor.getBoundingClientRect()

    setUp(flipsUp(drawn.getBoundingClientRect().height, box.top - top, bottom - box.bottom))
  }, [open])

  return { menu, up }
}
