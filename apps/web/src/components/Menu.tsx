import { useLocation } from 'preact-iso'
import { useEffect, useRef, useState } from 'preact/hooks'

import type { NavPage } from './Layout.tsx'

/**
 * The pages the bar has no room for.
 *
 * The bar carries one entry per thing and the bottom bar caps at six, so everything
 * else has been reached from the page it belongs to — which worked until a page
 * belonged to no other page. Rideshares is reachable only from a form that renders
 * for a burn you have already joined, so somebody who has not joined one cannot get
 * there at all. This is where those live.
 *
 * A drawer over the page rather than one that pushes it aside: sliding the site would
 * mean a `transform` on a wrapper, and a transform makes `position: fixed` resolve
 * against that wrapper instead of the viewport — which is the bottom bar and the
 * bell's panel, and the class of bug #344 and #348 already were.
 */
export const Menu = ({ pages }: { pages: readonly NavPage[] }) => {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const { path } = useLocation()

  useEffect(() => setOpen(false), [path])

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
      button.current?.focus()
    }

    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)

    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  if (pages.length === 0) return null

  return (
    <div class="menu-wrap" ref={wrap}>
      <button
        ref={button}
        type="button"
        class="menu-button"
        aria-label="Menu"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <span aria-hidden="true">☰</span>
      </button>

      {/* Rendered only while open, so the links are out of the tab order the rest of
          the time without `inert` or a visibility dance. */}
      {open && (
        <>
          <div class="menu-backdrop" />
          <nav class="menu-drawer" aria-label="More">
            {pages.map((page) => (
              <a key={page.href} class="menu-entry" href={page.href}>
                <span aria-hidden="true">{page.icon}</span> {page.label}
              </a>
            ))}
          </nav>
        </>
      )}
    </div>
  )
}
