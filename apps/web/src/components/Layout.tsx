import type { ComponentChildren } from 'preact'

import { apiRoutes } from '@sage-burner/shared'
import { useLocation } from 'preact-iso'

import type { BellApi } from './NotificationBell.tsx'

import { useBurns } from '../burn.tsx'
import { useInstallationTitle } from '../installation.tsx'
import { isAdmin, isApproved, useViewer } from '../viewer.tsx'
import { useHidingBar, usePhone } from '../viewport.ts'
import { Avatar } from './Avatar.tsx'
import { Menu } from './Menu.tsx'
import { NotificationBell } from './NotificationBell.tsx'

export interface NavPage {
  href: string
  label: string
  icon: string
}

/**
 * The pages an approved member moves between — words in the bar on a wide screen,
 * icons in the bottom bar on a phone (#337).
 *
 * One list, drawn twice, so the two cannot come to offer different pages. **Six is the
 * ceiling**: six by ~3.5rem fits a 360px phone and nothing wider fits beside it, so a
 * seventh page has to hang off one of these rather than take a seat.
 * `docs/the-app.md` has the rest, including why the Feed is first.
 */
const memberPages: readonly NavPage[] = [
  { href: '/feed', label: 'Feed', icon: '📜' },
  { href: '/members', label: 'Members', icon: '🧑‍🤝‍🧑' },
  { href: '/schedule', label: 'Schedule', icon: '🗓️' },
  // The path stays `/roles`: it is what any link already shared points at, and it is
  // not what anybody reads.
  { href: '/roles', label: 'Leads', icon: '🕴️' },
  { href: '/meals', label: 'Meals', icon: '🍽️' },
  { href: '/faq', label: 'FAQ', icon: '❓' },
]

/**
 * What ☰ holds: the pages the bar has no room for, at the leading edge of the bar
 * rather than on the logo — the logo goes home. `docs/the-app.md` has the rest.
 */
const menuPages: readonly NavPage[] = [{ href: '/rides', label: 'Rideshares', icon: '🛻' }]

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
 * question it answers. Somebody organising but not attending reaches both from ⚙️.
 *
 * **On a phone the six move to a fixed bar along the bottom** (#337), and the topbar
 * keeps what is about the session rather than a page.
 *
 * Every entry here is a **place**, which is why signing out is not among them: it is
 * an action, and it lives beside the sentence naming the account it ends.
 *
 * The one thing here that is not a link is the bell, which is why the frame takes an
 * API client (#248): it belongs in the bar because it is about the whole session
 * rather than any page, and it has to be reachable from all of them.
 */
export const Layout = ({ api, children }: { api: BellApi; children: ComponentChildren }) => {
  const viewer = useViewer()
  const { burns, selected, select } = useBurns()
  const title = useInstallationTitle()
  const phone = usePhone()

  // Open to `approved`, so an account holding `admin` alone reaches them from the nav
  // rather than by typing the URL — which is what the pages themselves allow.
  const approved = isApproved(viewer)
  const pages = approved ? memberPages : []
  const bottomBar = phone && pages.length > 0
  const hidden = useHidingBar(bottomBar)

  return (
    <div class={bottomBar ? 'layout has-bottom-bar' : 'layout'}>
      <header class="site-header">
        {/* Ahead of the logo, at the edge its drawer slides in from. */}
        <Menu pages={approved ? menuPages : []} />

        <a class="brand" href="/">
          {/* The icon route rather than the flame written out here: it answers with
              whatever an admin uploaded and with the app's own mark when nobody has,
              so the bar wears what the home screen does without having to ask which
              it is. Decorative — the name is right beside it. */}
          <img class="brand-mark" src={apiRoutes.getInstallationIcon.path()} alt="" />
          <span class="brand-name">{title}</span>
        </a>

        {/* Ahead of the nav, because everything after it is about the burn it names.
            Hidden when there is nothing to choose between: one burn is the ordinary
            case and a select with a single option is furniture. */}
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

        <TopNav api={api} pages={bottomBar ? [] : pages} />
      </header>

      <main class="site-main">{children}</main>

      <footer class="site-footer">
        <p>
          A co-created gathering. Run on <a href="https://github.com/fiddur/sage-burner">sage-burner</a>,
          which is free software under the AGPL.
        </p>
      </footer>

      {bottomBar && <BottomBar pages={pages} hidden={hidden} />}
    </div>
  )
}

/**
 * The bar across the top: the pages as words, and the bell, ⚙️ and the face.
 *
 * `pages` is empty when the bottom bar has them, which is the whole of the split. The
 * other three stay here on every viewport, none of them being a place.
 */
const TopNav = ({ api, pages }: { api: BellApi; pages: readonly NavPage[] }) => {
  const viewer = useViewer()

  return (
    <nav class="top-nav" aria-label="Main">
      {viewer.status === 'signed-out' && (
        <>
          <a href="/apply">Apply</a>
          <a href="/login">Log in</a>
        </>
      )}

      {pages.map((page) => (
        <a key={page.href} href={page.href}>
          {page.label}
        </a>
      ))}

      {/* One group, so a bar too narrow for everything drops the *pages* rather than
          leaving the face on a row of its own — an admin's corner is a third icon wide
          and was the first to go over. Signed in is the whole guard, so it sits
          outside the approved block; a visitor gets no empty box holding the end of
          the bar open. */}
      {viewer.account !== undefined && (
        <span class="nav-session">
          <NotificationBell api={api} />

          {isAdmin(viewer) && (
            <a class="nav-icon" href="/admin" aria-label="Organise" title="Organise">
              ⚙️
            </a>
          )}

          {/* `approved`, matching the page: an account holding `admin` and not `member`
              has a picture, ways of being reached and a notification switch there, and
              reaching them by typing the URL is not a way in (#396). */}
          {isApproved(viewer) && (
            <a class="nav-icon" href="/profile" aria-label="Your details" title="Your details">
              <Avatar
                accountId={viewer.account.id}
                name={viewer.account.name}
                avatar={viewer.account.avatar}
              />
            </a>
          )}
        </span>
      )}
    </nav>
  )
}

/**
 * The phone's nav: one icon per page, fixed along the bottom.
 *
 * Named rather than lettered — an emoji is not a word, so each carries the label the
 * bar spells out on a wide screen, which is what a screen reader reads and what a long
 * press shows. `aria-current` marks where you are, since a scrolled page has its own
 * heading off the top.
 *
 * `hidden` slides it away while somebody reads down a page (#340). The stylesheet takes
 * `visibility` with it once the slide is over, so a bar that is off the screen holds no
 * focusable links — a transform alone leaves six of them in the tab order.
 */
const BottomBar = ({ pages, hidden }: { pages: readonly NavPage[]; hidden: boolean }) => {
  const { path } = useLocation()

  return (
    <nav class={hidden ? 'bottom-bar is-hidden' : 'bottom-bar'} aria-label="Pages">
      {pages.map((page) => (
        <a
          key={page.href}
          class={path === page.href ? 'bottom-tab is-current' : 'bottom-tab'}
          href={page.href}
          aria-label={page.label}
          aria-current={path === page.href ? 'page' : undefined}
          title={page.label}
        >
          <span aria-hidden="true">{page.icon}</span>
        </a>
      ))}
    </nav>
  )
}
