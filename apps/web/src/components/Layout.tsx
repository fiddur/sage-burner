import type { ComponentChildren } from 'preact'

import { useBurns } from '../burn.tsx'
import { useInstallationTitle } from '../installation.tsx'
import { isAdmin, isApproved, isMember, useViewer } from '../viewer.tsx'
import { Avatar } from './Avatar.tsx'

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
              <a href="/meals">Meals</a>
            </>
          )}

          {isAdmin(viewer) && (
            <a href="/admin" aria-label="Organise" title="Organise">
              ⚙️
            </a>
          )}

          {isMember(viewer) && (
            <a class="avatar-link" href="/profile" aria-label="Your details" title="Your details">
              <Avatar
                accountId={viewer.account?.id ?? ''}
                name={viewer.account?.name ?? null}
                avatar={viewer.account?.avatar ?? null}
              />
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
