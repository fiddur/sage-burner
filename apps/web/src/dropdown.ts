import type { RefObject } from 'preact'

import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'

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

/**
 * A dropdown hangs below what opened it until that would put it somewhere nobody can reach.
 * Both halves are needed: a menu that does not fit below is no better flipped above a row near
 * the top of a short panel, so it only flips where there is more room to flip into.
 */
export const flipsUp = (menu: number, above: number, below: number): boolean => menu > below && above > below

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
