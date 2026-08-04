import type { ComponentChildren } from 'preact'

import type { ApiClient } from '../api/client.ts'

import { useInstallationTitle } from '../installation.tsx'
import { isApproved, isMember, useSetViewer, useViewer } from '../viewer.tsx'

/**
 * The frame every page sits in.
 *
 * The nav reflects who is looking: signed-out visitors get the public entry
 * points, and anyone with a role gets their own pages and `Organise` — which
 * offers a member the burn's shared furniture and an admin everything. Hiding a
 * link is presentation only — every one of these routes is guarded server-side as
 * well.
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

          {isMember(viewer) && (
            <>
              <a href="/my-burn">Your burn</a>
              <a href="/dreams">Dreams</a>
              <a href="/profile">Your details</a>
            </>
          )}

          {/* Open to `approved`, so an organiser holding `admin` alone reaches them
              from the nav rather than by typing the URL — which is what the pages
              themselves allow. */}
          {isApproved(viewer) && (
            <>
              <a href="/schedule">Schedule</a>
              <a href="/roles">Roles</a>
            </>
          )}

          {isApproved(viewer) && <a href="/admin">Organise</a>}

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
