import type { RefObject } from 'preact'

import { useEffect } from 'preact/hooks'

/**
 * What everything in `inside` can reach with Tab.
 *
 * Written out rather than derived: there is no way to ask the DOM "what is in the tab
 * order", and `tabbable`-style packages exist because the full answer needs layout.
 * This is the subset the overlays are built from; a caller reaching for something else
 * has to add it here.
 */
const REACHABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]),' +
  ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * While an overlay is up, the page behind it is not there: it does not scroll, and Tab
 * cannot reach into it (#364).
 *
 * Both halves are the same claim. An overlay that looks like it covers the page while
 * the page scrolls under it, or hands focus to a control nobody can see behind an
 * opaque backdrop, is telling two different stories about what is interactive.
 *
 * `open` defaults to true, for a caller mounted only while it is showing — the dream
 * panel is. ☰ is in the bar whether or not its drawer is out, so it says which.
 *
 * Only the **boundaries** are taken over; Tab in the middle is the browser's, as it
 * should be. At the last control Tab goes back to the first, and at the first —
 * or on the panel itself, which holds focus on open and is not in the tab order —
 * Shift+Tab goes to the last.
 */
export const useOverlay = (inside: RefObject<HTMLElement | null>, open = true) => {
  useEffect(() => {
    if (!open) return undefined

    const { body } = document
    const held = body.style.overflow
    body.style.overflow = 'hidden'

    const onKey = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== 'Tab') return

      const overlay = inside.current
      if (overlay === null) return

      const reachable = [...overlay.querySelectorAll<HTMLElement>(REACHABLE)]
      const first = reachable[0]
      const last = reachable.at(-1)
      if (first === undefined || last === undefined) return

      const focused = document.activeElement
      const outside = !(focused instanceof Node) || !overlay.contains(focused)
      const leaving = keyEvent.shiftKey
        ? outside || focused === first || focused === overlay
        : outside || focused === last

      if (!leaving) return

      keyEvent.preventDefault()
      ;(keyEvent.shiftKey ? last : first).focus()
    }

    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('keydown', onKey)
      body.style.overflow = held
    }
  }, [inside, open])
}
