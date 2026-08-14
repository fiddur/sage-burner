import { useLocation } from 'preact-iso'
import { useEffect, useRef, useState } from 'preact/hooks'

import type { NavPage } from './Layout.tsx'

import { useOverlay } from '../overlay.ts'
import { Icon } from './Icon.tsx'

export const Menu = ({ pages }: { pages: readonly NavPage[] }) => {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const drawer = useRef<HTMLElement>(null)
  const { path } = useLocation()

  const close = () => {
    setOpen(false)
    button.current?.focus()
  }

  const showing = open && pages.length > 0

  useOverlay(drawer, showing)

  useEffect(() => setOpen(false), [path])

  useEffect(() => {
    if (pages.length === 0) setOpen(false)
  }, [pages.length])

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
        aria-expanded={showing}
        aria-controls={showing ? 'menu-drawer' : undefined}
        onClick={() => setOpen((was) => !was)}
      >
        <Icon name="menu" />
      </button>

      {showing && (
        <>
          <div class="menu-backdrop" onPointerDown={close} />
          <nav id="menu-drawer" ref={drawer} class="menu-drawer" aria-label="More">
            {pages.map((page) => (
              <a
                key={page.href}
                class="menu-entry"
                href={page.href}
                {...(page.away === true ? { rel: 'noreferrer noopener', target: '_blank' } : {})}
                onClick={() => setOpen(false)}
              >
                <span aria-hidden="true">{page.icon}</span> {page.label}
                {page.away === true && (
                  <span class="menu-away" aria-label="opens elsewhere">
                    <Icon name="away" />
                  </span>
                )}
              </a>
            ))}

            <button type="button" class="menu-close" onClick={close}>
              <Icon name="close" /> Close
            </button>
          </nav>
        </>
      )}
    </div>
  )
}
