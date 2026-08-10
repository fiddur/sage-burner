import type { RefObject } from 'preact'

import { useEffect } from 'preact/hooks'

const REACHABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]),' +
  ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

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
