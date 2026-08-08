import { useLocation } from 'preact-iso'
import { useEffect, useRef, useState } from 'preact/hooks'

import type { NavPage } from './Layout.tsx'

/**
 * The pages the bar has no room for — `docs/the-app.md` has the why.
 *
 * Dismissal is the backdrop's own, not a document listener like the bell's. The
 * backdrop covers the viewport, so every press outside the drawer lands on it: an
 * "is this inside?" check against a wrapper containing the backdrop answers yes to
 * every press on the page, and the drawer never closes at all.
 */
export const Menu = ({ pages }: { pages: readonly NavPage[] }) => {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const { path } = useLocation()

  useEffect(() => setOpen(false), [path])

  useEffect(() => {
    if (!open) return undefined

    const escape = (key: KeyboardEvent) => {
      if (key.key !== 'Escape') return
      setOpen(false)
      button.current?.focus()
    }

    document.addEventListener('keydown', escape)

    return () => document.removeEventListener('keydown', escape)
  }, [open])

  if (pages.length === 0) return null

  return (
    <div class="menu-wrap">
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
          <div class="menu-backdrop" onPointerDown={() => setOpen(false)} />
          <nav class="menu-drawer" aria-label="More">
            {pages.map((page) => (
              // Closed here as well as on a route change, since following a link to the
              // page already open changes no route to react to.
              <a key={page.href} class="menu-entry" href={page.href} onClick={() => setOpen(false)}>
                <span aria-hidden="true">{page.icon}</span> {page.label}
              </a>
            ))}
          </nav>
        </>
      )}
    </div>
  )
}
