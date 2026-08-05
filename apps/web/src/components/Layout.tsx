import type { ComponentChildren } from 'preact'

import { useBurns } from '../burn.tsx'
import { useInstallationTitle } from '../installation.tsx'
import { isAdmin, isApproved, isMember, useViewer } from '../viewer.tsx'

/**
 * The initials for the corner — "Fredrik Liljegren" is FL, "Ada" is A.
 *
 * First and last word rather than every word, so a middle name does not produce a
 * circle of five letters. Falls back to a glyph rather than to an empty circle: an
 * account whose name nobody has filled in is ordinary, and that is exactly the
 * account whose owner most needs the link to the page that fixes it.
 *
 * `Intl.Segmenter` rather than `[0]`, because a string index takes half a surrogate
 * pair — a name starting with an emoji or an astral-plane character would render a
 * replacement glyph. Measured, not assumed.
 */
export const initials = (name: string | null | undefined): string => {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '👤'

  const first = words[0] ?? ''
  const last = words.length > 1 ? (words[words.length - 1] ?? '') : ''
  const letters = new Intl.Segmenter()

  return [first, last]
    .filter((word) => word !== '')
    .map((word) => [...letters.segment(word)][0]?.segment ?? '')
    .join('')
    .toLocaleUpperCase()
}

/**
 * The frame every page sits in.
 *
 * The nav reflects who is looking: signed-out visitors get the public entry points,
 * anyone with a role gets their own pages, and ⚙️ goes to admin alone. Hiding a link
 * is presentation only — every one of these routes is guarded server-side as well.
 *
 * The bar carries one entry per thing rather than one per page. Dreams is reached
 * from Schedule, which is where a dream is placed; Places from Schedule too, since
 * the lanes are what the grid draws; the lodging list from Your burn, beside the
 * question it answers. An organiser who is not attending reaches both from ⚙️.
 *
 * Every entry here is a **place**, which is why signing out is not among them: it is
 * an action, and it lives beside the sentence naming the account it ends. That also
 * leaves this frame needing no API client at all.
 */
export const Layout = ({ children }: { children: ComponentChildren }) => {
  const viewer = useViewer()
  const { burns, selected, select } = useBurns()
  const title = useInstallationTitle()

  return (
    <div class="layout">
      <header class="site-header">
        <a class="brand" href="/">
          <span class="brand-mark" aria-hidden="true">
            🔥
          </span>
          <span class="brand-name">{title}</span>
        </a>

        {/* Leftmost, because everything to the right of it is about the burn it
            names. Hidden when there is nothing to choose between: one burn is the
            ordinary case and a select with a single option is furniture. */}
        {burns.length > 1 && selected !== undefined && (
          <select
            class="burn-selector"
            aria-label="Which burn"
            value={selected.event.id}
            onChange={(changeEvent) => select(changeEvent.currentTarget.value)}
          >
            {burns.map((burn) => (
              <option key={burn.event.id} value={burn.event.id}>
                {burn.event.name}
              </option>
            ))}
          </select>
        )}

        <nav aria-label="Main">
          {viewer.status === 'signed-out' && (
            <>
              <a href="/apply">Apply</a>
              <a href="/login">Log in</a>
            </>
          )}

          {/* Open to `approved`, so an organiser holding `admin` alone reaches them
              from the nav rather than by typing the URL — which is what the pages
              themselves allow. */}
          {isApproved(viewer) && (
            <>
              <a href="/members">Members</a>
              <a href="/schedule">Schedule</a>
              <a href="/roles">Roles</a>
            </>
          )}

          {isAdmin(viewer) && (
            <a href="/admin" aria-label="Organise" title="Organise">
              ⚙️
            </a>
          )}

          {isMember(viewer) && (
            <a class="avatar" href="/profile" aria-label="Your details" title="Your details">
              <span aria-hidden="true">{initials(viewer.account?.name)}</span>
            </a>
          )}
        </nav>
      </header>

      <main class="site-main">{children}</main>

      <footer class="site-footer">
        <p>
          A co-created gathering. Run on <a href="https://github.com/fiddur/sage-burner">sage-burner</a>,
          which is free software under the AGPL.
        </p>
      </footer>
    </div>
  )
}
