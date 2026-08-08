import { useLocation } from 'preact-iso'
import { useEffect, useRef, useState } from 'preact/hooks'

import type { NavPage } from './Layout.tsx'

import { useOverlay } from '../overlay.ts'

/** The pages the bar has no room for. `docs/the-app.md` has the why, and why
 * dismissal is the backdrop's own rather than a document listener like the bell's. */
export const Menu = ({ pages }: { pages: readonly NavPage[] }) => {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const drawer = useRef<HTMLElement>(null)
  const { path } = useLocation()

  // Focus is inside the drawer, and closing unmounts it — so every way out has to hand
  // focus back rather than let it fall to `<body>`.
  const close = () => {
    setOpen(false)
    button.current?.focus()
  }

  // `pages` as well as `open`: the early return below is what stops rendering, and an
  // account whose roles fall away — a background 401 — would otherwise leave the page
  // locked with no drawer on it (#311).
  const showing = open && pages.length > 0

  useOverlay(drawer, showing)

  useEffect(() => setOpen(false), [path])

  useEffect(() => {
    if (!showing) return undefined

    drawer.current?.querySelector('a')?.focus()

    const escape = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === 'Escape') close()
    }

    document.addEventListener('keydown', escape)

    return () => document.removeEventListener('keydown', escape)
  }, [showing])

  if (pages.length === 0) return null

  return (
    <div class="menu-wrap">
      <button
        ref={button}
        type="button"
        class="menu-button"
        aria-label="Menu"
        aria-expanded={open}
        aria-controls={open ? 'menu-drawer' : undefined}
        onClick={() => setOpen((was) => !was)}
      >
        <span aria-hidden="true">☰</span>
      </button>

      {/* Rendered only while open rather than hidden: no `inert` to keep in step with
          the animation, and the links are out of the tab order the rest of the time. */}
      {showing && (
        <>
          <div class="menu-backdrop" onPointerDown={close} />
          <nav id="menu-drawer" ref={drawer} class="menu-drawer" aria-label="More">
            {pages.map((page) => (
              // Closed here as well as on a route change, since following a link to the
              // page already open changes no route to react to.
              <a key={page.href} class="menu-entry" href={page.href} onClick={() => setOpen(false)}>
                <span aria-hidden="true">{page.icon}</span> {page.label}
              </a>
            ))}

            {/* The drawer covers ☰ itself, so without this the only pointer way out is
                the strip of backdrop beside it. */}
            <button type="button" class="menu-close" onClick={close}>
              ✕ Close
            </button>
          </nav>
        </>
      )}
    </div>
  )
}
