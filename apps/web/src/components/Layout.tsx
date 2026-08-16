import type { ComponentChildren } from 'preact'

import { apiRoutes } from '@sage-burner/shared'
import { useLocation } from 'preact-iso'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'
import type { BellApi } from './NotificationBell.tsx'

import { useBurns } from '../burn.tsx'
import { useInstallationTitle } from '../installation.tsx'
import { useLoad } from '../load.ts'
import { useSidebar } from '../sidebar.ts'
import { isAdmin, isApproved, useViewer } from '../viewer.tsx'
import { useHidingBar, usePhone } from '../viewport.ts'
import { Avatar } from './Avatar.tsx'
import { Icon } from './Icon.tsx'
import { Menu, Sidebar } from './Menu.tsx'
import { NotificationBell } from './NotificationBell.tsx'

export interface NavPage {
  href: string
  label: string
  icon: string
  away?: boolean
}

const memberPages: readonly NavPage[] = [
  { href: '/feed', label: 'Feed', icon: '📜' },
  { href: '/members', label: 'Members', icon: '🧑‍🤝‍🧑' },
  { href: '/schedule', label: 'Schedule', icon: '🗓️' },
  { href: '/roles', label: 'Leads', icon: '🕴️' },
  { href: '/meals', label: 'Meals', icon: '🍽️' },
  { href: '/faq', label: 'FAQ', icon: '❓' },
]

const menuPages: readonly NavPage[] = [
  { href: '/songs', label: 'Songbook', icon: '🎵' },
  { href: '/rides', label: 'Rideshares', icon: '🛻' },
  { href: '/bring', label: 'Bring list', icon: '🎁' },
  { href: '/meetings', label: 'Meetings', icon: '🗣️' },
]

export type LayoutApi = BellApi & Pick<ApiClient, 'getMapLink'>

export const Layout = ({ api, children }: { api: LayoutApi; children: ComponentChildren }) => {
  const viewer = useViewer()
  const { burns, selected, select } = useBurns()
  const title = useInstallationTitle()
  const phone = usePhone()

  const approved = isApproved(viewer)
  const pages = approved ? memberPages : []
  const { loaded: map } = useLoad(async (signal) => (await api.getMapLink(signal)).map.url, {
    enabled: approved,
    fallback: 'Could not load the map link.',
  })
  const mapUrl = map.status === 'ready' ? map.data : null
  const bottomBar = phone && pages.length > 0
  const hidden = useHidingBar(bottomBar)
  const sidebar = useSidebar()
  const opener = useRef<HTMLButtonElement>(null)
  const [handingBack, setHandingBack] = useState(false)

  const everyPage = approved ? [...memberPages, ...withMap(menuPages, mapUrl)] : []
  const aside = !phone && everyPage.length > 0 && !sidebar.hidden

  // Only after the click that hid it: the sidebar also starts hidden for whoever hid it last
  // time, and moving focus on load would take it off whatever the page put it on.
  useLayoutEffect(() => {
    if (!handingBack) return

    opener.current?.focus()
    setHandingBack(false)
  }, [handingBack])

  return (
    <div class={classesFor({ bottomBar, aside })}>
      <header class="site-header">
        {phone ? (
          <Menu pages={approved ? withMap(menuPages, mapUrl) : []} />
        ) : (
          everyPage.length > 0 &&
          sidebar.hidden && (
            <button ref={opener} type="button" class="menu-button" aria-label="Menu" onClick={sidebar.show}>
              <Icon name="menu" />
            </button>
          )
        )}

        <a class="brand" href="/">
          <img class="brand-mark" src={apiRoutes.getInstallationIcon.path()} alt="" />
          <span class="brand-name">{title}</span>
        </a>

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

        <TopNav api={api} />
      </header>

      {aside && (
        <Sidebar
          pages={everyPage}
          onHide={() => {
            sidebar.hide()
            setHandingBack(true)
          }}
        />
      )}

      <main class="site-main">{children}</main>

      <footer class="site-footer">
        <p>
          A co-created gathering. Run on <a href="https://github.com/fiddur/sage-burner">sage-burner</a>,
          which is free software under the AGPL. <a href="/privacy">Privacy</a>. <a href="/terms">Terms</a>.
        </p>
      </footer>

      {bottomBar && <BottomBar pages={pages} hidden={hidden} />}
    </div>
  )
}

const withMap = (pages: readonly NavPage[], url: string | null): readonly NavPage[] =>
  url === null ? pages : [...pages, { href: url, label: 'Map of area', icon: '🗺️', away: true }]

const classesFor = ({ bottomBar, aside }: { bottomBar: boolean; aside: boolean }): string =>
  ['layout', bottomBar && 'has-bottom-bar', aside && 'has-sidebar'].filter(Boolean).join(' ')

const TopNav = ({ api }: { api: BellApi }) => {
  const viewer = useViewer()

  return (
    <nav class="top-nav" aria-label="Main">
      {viewer.status === 'signed-out' && (
        <>
          <a href="/apply">Apply</a>
          <a href="/login">Log in</a>
        </>
      )}

      {viewer.account !== undefined && (
        <span class="nav-session">
          <NotificationBell api={api} />

          {isAdmin(viewer) && (
            <a class="nav-icon" href="/admin" aria-label="Organise" title="Organise">
              <Icon name="organise" />
            </a>
          )}

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
