import type { AccountRole, MyBurn } from '@sage-burner/shared'

import { apiRoutes } from '@sage-burner/shared'
import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { LocationProvider } from 'preact-iso'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { LayoutApi } from './Layout.tsx'

import { BurnProvider } from '../burn.tsx'
import { initials } from '../initials.ts'
import { InstallationProvider } from '../installation.tsx'
import { onADesktop, onAPhone } from '../testing/viewport.ts'
import { ViewerProvider } from '../viewer.tsx'
import { Layout } from './Layout.tsx'

afterEach(cleanup)
afterEach(onADesktop)

const renderNav = (viewer: Viewer, api: LayoutApi = noBell) =>
  render(
    <InstallationProvider title="Sage Burner">
      <ViewerProvider viewer={viewer}>
        <Layout api={api}>
          <p>the page</p>
        </Layout>
      </ViewerProvider>
    </InstallationProvider>,
  )

const signedInAs = (...roles: AccountRole[]): Viewer => ({
  status: 'signed-in',
  account: { id: 'a-1', name: 'Ada Lovelace', avatar: null, roles },
})

const nameOf = (link: Element): string => {
  const said = link.getAttribute('aria-label')
  if (said !== null) return said

  const copy = link.cloneNode(true)
  if (!(copy instanceof Element)) return link.textContent?.trim() ?? ''

  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove()

  return copy.textContent?.trim() ?? ''
}

const links = () => screen.getAllByRole('link').map(nameOf)

const expectLinks = (present: string[], absent: string[]) => {
  const shown = links()
  for (const label of present) expect(shown, `${label} should be offered`).toContain(label)
  for (const label of absent) expect(shown, `${label} should not be offered`).not.toContain(label)
}

const noBell: LayoutApi = {
  getMyNotifications: () => Promise.resolve({ notifications: [], unseen: 0 }),
  markNotificationsSeen: () => Promise.reject(new Error('markNotificationsSeen is not stubbed here')),
  deleteMyNotification: () => Promise.reject(new Error('deleteMyNotification is not stubbed here')),
  getMyNotificationSettings: () => Promise.reject(new Error('getMyNotificationSettings is not stubbed here')),
  updateMyNotificationSettings: () =>
    Promise.reject(new Error('updateMyNotificationSettings is not stubbed here')),
  getMapLink: () => Promise.resolve({ map: { url: null } }),
}

describe('the nav', () => {
  it('offers a signed-out visitor the way in, and none of the pages behind it', () => {
    renderNav({ status: 'signed-out' })

    expectLinks(
      ['Apply', 'Log in'],
      ['Feed', 'Members', 'Schedule', 'Leads', 'FAQ', 'Your details', 'Organise'],
    )
  })

  it('gives a member their own pages and the shared ones', () => {
    renderNav(signedInAs('member'))

    expectLinks(['Feed', 'Members', 'Schedule', 'Leads', 'FAQ', 'Your details'], ['Your burn'])
  })

  it("gives the corner's icons one class, since neither of them is a word", () => {
    renderNav(signedInAs('admin', 'member'))

    for (const label of ['Organise', 'Your details']) {
      expect(screen.getByRole('link', { name: label }).className).toContain('nav-icon')
    }
  })

  it('keeps Organise from a member who is not an admin', () => {
    renderNav(signedInAs('member'))

    expectLinks([], ['Organise'])
  })

  it('reaches the shared pages for an admin who holds admin alone', () => {
    renderNav(signedInAs('admin'))

    expectLinks(['Feed', 'Members', 'Schedule', 'Leads', 'FAQ', 'Organise', 'Your details'], ['Your burn'])
  })

  it('offers it to nobody who is not approved at all', () => {
    renderNav({
      status: 'signed-in',
      account: { id: 'a-1', name: 'Ada Lovelace', avatar: null, roles: [] },
    })

    expectLinks([], ['Your details', 'Organise'])
  })

  it('offers Dreams from the Schedule rather than from the bar', () => {
    renderNav(signedInAs('member', 'admin'))

    expectLinks(['Schedule'], ['Dreams'])
  })

  it('puts the details behind initials, and falls back to a glyph without a name', () => {
    renderNav(signedInAs('member'))
    expect(screen.getByRole('link', { name: 'Your details' }).textContent).toBe('AL')

    cleanup()
    renderNav({ status: 'signed-in', account: { id: 'a-2', name: null, avatar: null, roles: ['member'] } })
    expect(screen.getByRole('link', { name: 'Your details' }).textContent).toBe('👤')
  })

  it('offers an account with no roles none of them', () => {
    renderNav(signedInAs())

    expectLinks(
      [],
      ['Your burn', 'Feed', 'Members', 'Dreams', 'Schedule', 'Leads', 'FAQ', 'Your details', 'Organise'],
    )
  })
})

describe('the shape of the bar', () => {
  it('opens with ☰ on a phone, at the edge its drawer comes from', () => {
    onAPhone()
    renderNav(signedInAs('member'))

    const bar = document.querySelector('.site-header')

    expect([...(bar?.children ?? [])].map((child) => child.className)).toEqual([
      'menu-wrap',
      'brand',
      'top-nav',
    ])
  })

  it('has no ☰ on a wide screen while the pages are beside it', () => {
    renderNav(signedInAs('member'))

    expect(screen.queryByRole('button', { name: 'Menu' })).toBeNull()
    expect(screen.getByRole('navigation', { name: 'Pages' })).toBeTruthy()
  })

  it('holds the bell, ⚙️ and the face in one group a narrow bar cannot break up', () => {
    renderNav(signedInAs('admin', 'member'))

    const group = document.querySelector('.nav-session')

    expect([...(group?.children ?? [])].map((child) => child.className)).toEqual([
      'bell-wrap',
      'nav-icon',
      'nav-icon',
    ])
  })
})

describe('the menu at the edge of the bar', () => {
  it('carries the pages the bar has no room for', async () => {
    onAPhone()
    renderNav(signedInAs('member'))

    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))

    expect((await screen.findByRole('link', { name: /Rideshares/ })).getAttribute('href')).toBe('/rides')
    expect(screen.getByRole('link', { name: /Bring list/ }).getAttribute('href')).toBe('/bring')
  })

  it('is offered on a phone as well, where the bar is fullest', () => {
    onAPhone()
    renderNav(signedInAs('member'))

    expect(screen.getByRole('button', { name: 'Menu' })).toBeTruthy()
  })

  it('is not offered to somebody who may open none of it', () => {
    renderNav({ status: 'signed-out' })

    expect(screen.queryByRole('button', { name: 'Menu' })).toBeNull()
  })
})

describe('the link to the map of the area', () => {
  const MAP = 'https://maps.example.org/the-field'

  const withMapLink = (url: string | null): LayoutApi => ({
    ...noBell,
    getMapLink: () => Promise.resolve({ map: { url } }),
  })

  it('is in the menu, opening where the map lives', async () => {
    onAPhone()
    renderNav(signedInAs('member'), withMapLink(MAP))

    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))

    const link = await screen.findByRole('link', { name: /Map of area/ })
    expect(link.getAttribute('href')).toBe(MAP)
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noreferrer noopener')
  })

  it('says it leaves the app, since nothing else in the drawer does', async () => {
    onAPhone()
    renderNav(signedInAs('member'), withMapLink(MAP))

    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))

    const away = await screen.findByRole('link', { name: /Map of area/ })

    expect(away.querySelector('[data-icon="away"]')).not.toBeNull()
  })

  it('is not there at all where nobody has set one', async () => {
    onAPhone()
    renderNav(signedInAs('member'), withMapLink(null))

    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))

    await screen.findByRole('link', { name: /Rideshares/ })
    expect(screen.queryByRole('link', { name: /Map of area/ })).toBeNull()
  })

  it('is asked for only where somebody may read it', () => {
    const getMapLink = vi.fn<LayoutApi['getMapLink']>(() => Promise.resolve({ map: { url: MAP } }))
    renderNav({ status: 'signed-out' }, { ...noBell, getMapLink })

    expect(getMapLink).not.toHaveBeenCalled()
  })
})

describe('the column of pages beside a wide page', () => {
  const ALL = [
    'Feed',
    'Members',
    'Schedule',
    'Leads',
    'Meals',
    'FAQ',
    'Songbook',
    'Rideshares',
    'Bring list',
    'Meetings',
  ]

  const beside = () =>
    [...screen.getByRole('navigation', { name: 'Pages' }).querySelectorAll('a')].map(nameOf)

  const MAP = 'https://maps.example.org/the-field'

  const withTheMap: LayoutApi = { ...noBell, getMapLink: () => Promise.resolve({ map: { url: MAP } }) }

  const startedAt = `${globalThis.location.pathname}${globalThis.location.search}`

  const renderNavAt = (at: string) => {
    history.replaceState(null, '', at)

    return render(
      <LocationProvider>
        <InstallationProvider title="Sage Burner">
          <ViewerProvider viewer={signedInAs('member')}>
            <Layout api={noBell}>
              <p>the page</p>
            </Layout>
          </ViewerProvider>
        </InstallationProvider>
      </LocationProvider>,
    )
  }

  afterEach(() => globalThis.localStorage.clear())
  afterEach(() => history.replaceState(null, '', startedAt))

  it('is there on load, carrying every page and not only the six', async () => {
    renderNav(signedInAs('member'), withTheMap)

    await screen.findByRole('link', { name: /Map of area/ })
    expect(beside()).toEqual([...ALL, 'Map of area'])
  })

  it('marks the page somebody is on, the way the bottom bar does', () => {
    renderNavAt('/feed')

    expect(screen.getByRole('link', { name: 'Feed' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Members' }).getAttribute('aria-current')).toBeNull()
  })

  it('hands focus to ☰ when the column it was in goes away', () => {
    renderNav(signedInAs('member'))

    fireEvent.click(screen.getByRole('button', { name: 'Hide the menu' }))

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Menu' }))
  })

  it('leaves focus alone on a load that starts hidden', () => {
    renderNav(signedInAs('member'))
    fireEvent.click(screen.getByRole('button', { name: 'Hide the menu' }))
    cleanup()

    renderNav(signedInAs('member'))

    expect(document.activeElement).toBe(document.body)
  })

  it('hides on the button, and ☰ brings it back', () => {
    renderNav(signedInAs('member'))

    fireEvent.click(screen.getByRole('button', { name: 'Hide the menu' }))

    expect(screen.queryByRole('navigation', { name: 'Pages' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))

    expect(screen.getByRole('navigation', { name: 'Pages' })).toBeTruthy()
  })

  it('stays hidden on the next load, that being a decision rather than a state', () => {
    renderNav(signedInAs('member'))
    fireEvent.click(screen.getByRole('button', { name: 'Hide the menu' }))
    cleanup()

    renderNav(signedInAs('member'))

    expect(screen.queryByRole('navigation', { name: 'Pages' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Menu' })).toBeTruthy()
  })

  it('comes back on the next load once it is asked back', () => {
    renderNav(signedInAs('member'))
    fireEvent.click(screen.getByRole('button', { name: 'Hide the menu' }))
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    cleanup()

    renderNav(signedInAs('member'))

    expect(screen.getByRole('navigation', { name: 'Pages' })).toBeTruthy()
  })

  it('is not there for somebody who may open none of it, and nor is ☰', () => {
    renderNav({ status: 'signed-out' })

    expect(screen.queryByRole('navigation', { name: 'Pages' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Menu' })).toBeNull()
  })

  it('is not there on a phone, where the bottom bar and the drawer are', () => {
    onAPhone()
    renderNav(signedInAs('member'))

    expect(document.querySelector('.sidebar')).toBeNull()
    expect(screen.getByRole('button', { name: 'Menu' })).toBeTruthy()
  })
})

describe('the nav on a phone', () => {
  const pages = ['Feed', 'Members', 'Schedule', 'Leads', 'Meals', 'FAQ']

  const inTheBottomBar = () =>
    [...screen.getByRole('navigation', { name: 'Pages' }).querySelectorAll('a')].map((link) =>
      link.getAttribute('aria-label'),
    )

  const inTheTopBar = () =>
    [...screen.getByRole('navigation', { name: 'Main' }).querySelectorAll('a')].map(nameOf)

  const inTheSidebar = () =>
    [...screen.getByRole('navigation', { name: 'Pages' }).querySelectorAll('a')].map(nameOf)

  it('moves the pages to a bar along the bottom', () => {
    onAPhone()
    renderNav(signedInAs('member'))

    expect(inTheBottomBar()).toEqual(pages)
  })

  it('leaves the topbar what is about the session rather than a page', () => {
    onAPhone()
    renderNav(signedInAs('admin', 'member'))

    const top = inTheTopBar()
    for (const label of pages) expect(top, `${label} should have moved down`).not.toContain(label)
    for (const label of ['Notifications', 'Organise', 'Your details']) {
      expect(top, `${label} should have stayed up`).toContain(label)
    }
  })

  it('puts the words in the column beside the page where there is room for them', () => {
    onADesktop()
    renderNav(signedInAs('member'))

    for (const label of pages) {
      expect(inTheSidebar(), `${label} should be beside the page`).toContain(label)
      expect(inTheTopBar(), `${label} should have left the bar`).not.toContain(label)
    }
  })

  it('starts the bar shown, whatever it does on a scroll', () => {
    onAPhone()
    renderNav(signedInAs('member'))

    expect(screen.getByRole('navigation', { name: 'Pages' }).className).toBe('bottom-bar')
  })

  it('gives a signed-out visitor no bottom bar at all', () => {
    onAPhone()
    renderNav({ status: 'signed-out' })

    expect(screen.queryByRole('navigation', { name: 'Pages' })).toBeNull()
    expect(inTheTopBar()).toContain('Apply')
  })

  it('gives an account with no roles none either', () => {
    onAPhone()
    renderNav(signedInAs())

    expect(screen.queryByRole('navigation', { name: 'Pages' })).toBeNull()
  })
})

describe('the brand', () => {
  it('wears the installation icon rather than a flame written into the bar', () => {
    renderNav(signedInAs('member'))

    const mark = document.querySelector('img.brand-mark')
    expect(mark?.getAttribute('src')).toBe(apiRoutes.getInstallationIcon.path())
    expect(mark?.getAttribute('alt')).toBe('')
  })
})

describe('the footer', () => {
  it('carries the policy on every page, signed in or not', () => {
    renderNav({ status: 'signed-out' })

    const footer = document.querySelector('footer.site-footer')
    const hrefs = [...(footer?.querySelectorAll('a') ?? [])].map((link) => link.getAttribute('href'))
    expect(hrefs).toContain('/privacy')
    expect(hrefs).toContain('https://github.com/fiddur/sage-burner')
  })
})

describe('initials', () => {
  it('takes the first and last word, so a middle name does not make five letters', () => {
    expect(initials('Ada Lovelace')).toBe('AL')
    expect(initials('Fredrik Erik Anders Liljegren')).toBe('FL')
  })

  it('takes one letter from a single name', () => {
    expect(initials('Ada')).toBe('A')
  })

  it('falls back to a glyph rather than an empty circle', () => {
    expect(initials(null)).toBe('👤')
    expect(initials(undefined)).toBe('👤')
    expect(initials('   ')).toBe('👤')
  })

  it('takes a whole character, not half a surrogate pair', () => {
    expect(initials('🌟ada')).toBe('🌟')
    expect(initials('Ægir Ödegård')).toBe('ÆÖ')
  })

  it('uppercases what it finds, since a lowercased name is still a name', () => {
    expect(initials('ada lovelace')).toBe('AL')
  })
})

describe('the burn selector', () => {
  const aBurn = (id: string, name: string): MyBurn => ({
    event: {
      id,
      name,
      slug: name.toLowerCase(),
      start_date: '2026-08-01',
      end_date: '2026-08-05',
      start_time: '16:00',
      end_time: '12:00',
    },
    attendance: null,
  })

  const renderWithBurns = (burns: MyBurn[], select = () => undefined) =>
    render(
      <InstallationProvider title="Sage Burner">
        <ViewerProvider viewer={signedInAs('member')}>
          <BurnProvider value={{ status: 'ready', burns, selected: burns[0], select }}>
            <Layout api={noBell}>
              <p>the page</p>
            </Layout>
          </BurnProvider>
        </ViewerProvider>
      </InstallationProvider>,
    )

  it('offers each burn, and says which one the rest of the bar is about', () => {
    renderWithBurns([aBurn('e-1', 'Summer'), aBurn('e-2', 'Winter')])

    const selector = screen.getByRole('combobox', { name: 'Which burn' })
    expect(selector).toHaveProperty('value', 'e-1')
    expect([...screen.getAllByRole('option')].map((option) => option.textContent)).toEqual([
      'Summer',
      'Winter',
    ])
  })

  it('reports the choice rather than navigating', () => {
    const select = vi.fn()
    renderWithBurns([aBurn('e-1', 'Summer'), aBurn('e-2', 'Winter')], select)

    fireEvent.change(screen.getByRole('combobox', { name: 'Which burn' }), { target: { value: 'e-2' } })

    expect(select).toHaveBeenCalledWith('e-2')
  })

  it('is absent with one burn to choose from, since a one-option select is furniture', () => {
    renderWithBurns([aBurn('e-1', 'Summer')])

    expect(screen.queryByRole('combobox', { name: 'Which burn' })).toBeNull()
  })

  it('is absent with none, rather than an empty control', () => {
    renderWithBurns([])

    expect(screen.queryByRole('combobox', { name: 'Which burn' })).toBeNull()
  })
})
