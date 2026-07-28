import type { ComponentChildren } from 'preact'

import { isAdmin, isMember, useSession } from '../session.tsx'

/**
 * The frame every page sits in.
 *
 * The nav reflects who is looking: signed-out visitors get the public entry
 * points, members get their own pages, admins additionally get the organising
 * ones. Hiding a link is presentation only — every one of these routes is
 * guarded server-side as well.
 */
export const Layout = ({ children }: { children: ComponentChildren }) => {
  const session = useSession()

  return (
    <div class="layout">
      <header class="site-header">
        <a class="brand" href="/">
          <span class="brand-mark" aria-hidden="true">
            🔥
          </span>
          <span class="brand-name">Sage Burner</span>
        </a>

        <nav aria-label="Main">
          {session.status === 'signed-out' && (
            <>
              <a href="/apply">Apply</a>
              <a href="/login">Log in</a>
            </>
          )}

          {isMember(session) && (
            <>
              <a href="/profile">My details</a>
              <a href="/schedule">Schedule</a>
            </>
          )}

          {isAdmin(session) && <a href="/admin">Organise</a>}
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
