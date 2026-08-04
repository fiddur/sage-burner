import type { ComponentChildren } from 'preact'

import type { ApiClient } from '../api/client.ts'

import { useInstallationTitle } from '../installation.tsx'
import { isAdmin, isApproved, isMember, useSetViewer, useViewer } from '../viewer.tsx'

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
 */
export const Layout = ({
  children,
  api,
}: {
  children: ComponentChildren
  api: Pick<ApiClient, 'logout'>
}) => {
  const viewer = useViewer()
  const setViewer = useSetViewer()
  const title = useInstallationTitle()

  const logOut = async () => {
    // The cookie is cleared server-side; the local viewer is cleared either
    // way. A failed logout that left the nav saying "Log out" would be worse
    // than one that says signed-out while a stale cookie expires on its own.
    //
    // Caught rather than only `finally`, which is what this had first: without
    // a catch the rejection escapes as an unhandled promise rejection, since
    // the click handler cannot await it. There is nothing to report — the user
    // asked to be signed out and, locally, they are.
    try {
      await api.logout()
    } catch {
      // Deliberately ignored; see above.
    }

    setViewer(null)
  }

  return (
    <div class="layout">
      <header class="site-header">
        <a class="brand" href="/">
          <span class="brand-mark" aria-hidden="true">
            🔥
          </span>
          <span class="brand-name">{title}</span>
        </a>

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

          {viewer.status === 'signed-in' && (
            <button type="button" class="link-button" onClick={() => void logOut()}>
              Log out
            </button>
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
