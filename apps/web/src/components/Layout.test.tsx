import type { AccountRole, MyBurn } from '@sage-burner/shared'

import { apiRoutes } from '@sage-burner/shared'
import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'

import { BurnProvider } from '../burn.tsx'
import { initials } from '../initials.ts'
import { InstallationProvider } from '../installation.tsx'
import { onADesktop, onAPhone } from '../testing/viewport.ts'
import { ViewerProvider } from '../viewer.tsx'
import { Layout } from './Layout.tsx'

afterEach(cleanup)
afterEach(onADesktop)

const renderNav = (viewer: Viewer) =>
  render(
    <InstallationProvider title="Sage Burner">
      <ViewerProvider viewer={viewer}>
        <Layout api={noBell}>
          <p>the page</p>
        </Layout>
      </ViewerProvider>
    </InstallationProvider>,
  )

const signedInAs = (...roles: AccountRole[]): Viewer => ({
  status: 'signed-in',
  account: { id: 'a-1', name: 'Ada Lovelace', avatar: null, roles },
})

// The gear is a glyph, so its name comes from `aria-label` rather than its text.
const links = () =>
  screen.getAllByRole('link').map((link) => link.getAttribute('aria-label') ?? link.textContent)

/**
 * Asserted one at a time, never as a negated `arrayContaining`.
 *
 * `expect(links).not.toEqual(expect.arrayContaining(['a', 'b', 'c']))` passes when
 * *any one* of the three is absent — measured, not assumed — so a test written that
 * way stays green while two of the three leak. Every absence here names one link.
 */
const expectLinks = (present: string[], absent: string[]) => {
  const shown = links()
  for (const label of present) expect(shown, `${label} should be offered`).toContain(label)
  for (const label of absent) expect(shown, `${label} should not be offered`).not.toContain(label)
}

/**
 * The bell asks on mount wherever the layout is drawn. Resolving with nothing keeps
 * these tests about the nav rather than about what has happened to anybody.
 */
const noBell = {
  getMyNotifications: () => Promise.resolve({ notifications: [], unseen: 0 }),
  markNotificationsSeen: () => Promise.reject(new Error('markNotificationsSeen is not stubbed here')),
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

    // "Your burn" is not among them: the burns are sections of the details page
    // now, since more than one is planned at a time and the singular was from when
    // there was only ever the next one (#184).
    expectLinks(['Feed', 'Members', 'Schedule', 'Leads', 'FAQ', 'Your details'], ['Your burn'])
  })

  it("gives the corner's icons one class, since neither of them is a word", () => {
    // The wheel wore the nav's underline while the face beside it did not. One class
    // for both, so a third icon in that corner cannot be added without it.
    //
    // The class, not the underline: happy-dom applies no CSS, so nothing here can
    // pin `text-decoration: none` — the shared class is the half that is testable.
    renderNav(signedInAs('admin', 'member'))

    for (const label of ['Organise', 'Your details']) {
      expect(screen.getByRole('link', { name: label }).className).toContain('nav-icon')
    }
  })

  it('keeps Organise from a member who is not an admin', () => {
    // The ⚙️ split: the page behind it is admin's alone now, so offering it to a
    // member sends them to a refusal. The burn's shared furniture, which a member
    // does curate, is reached from Schedule and from their own details instead.
    renderNav(signedInAs('member'))

    expectLinks([], ['Organise'])
  })

  it('reaches the shared pages for an admin who holds admin alone', () => {
    // Schedule and Leads are `requireApproved` server-side, so an admin who is
    // not attending may use them — and used to be able to only by typing the URL,
    // because the nav gated them on `member`. The personal pages stay behind
    // `member`, since somebody not attending has no stay to fill in.
    renderNav(signedInAs('admin'))

    expectLinks(['Feed', 'Members', 'Schedule', 'Leads', 'FAQ', 'Organise'], ['Your burn', 'Your details'])
  })

  it('offers Dreams from the Schedule rather than from the bar', () => {
    // Merged in #184: the schedule is where a dream is placed, and two entries for
    // one thing is what the restructure is undoing.
    renderNav(signedInAs('member', 'admin'))

    expectLinks(['Schedule'], ['Dreams'])
  })

  it('puts the details behind initials, and falls back to a glyph without a name', () => {
    // The corner is an avatar image later; initials are the placeholder. A name
    // nobody has filled in is ordinary — the bootstrap admin has none — and that is
    // exactly the account whose owner most needs the link to the page that fixes it.
    renderNav(signedInAs('member'))
    expect(screen.getByRole('link', { name: 'Your details' }).textContent).toBe('AL')

    cleanup()
    renderNav({ status: 'signed-in', account: { id: 'a-2', name: null, avatar: null, roles: ['member'] } })
    expect(screen.getByRole('link', { name: 'Your details' }).textContent).toBe('👤')
  })

  it('offers an account with no roles none of them', () => {
    // An applicant with an account, waiting on a decision. Every link named, because
    // this is the case where a leak would matter.
    renderNav(signedInAs())

    expectLinks(
      [],
      ['Your burn', 'Feed', 'Members', 'Dreams', 'Schedule', 'Leads', 'FAQ', 'Your details', 'Organise'],
    )
  })
})

describe('the shape of the bar', () => {
  it('opens with ☰, at the edge its drawer comes from', () => {
    renderNav(signedInAs('member'))

    const bar = document.querySelector('.site-header')

    expect([...(bar?.children ?? [])].map((child) => child.className)).toEqual([
      'menu-wrap',
      'brand',
      'top-nav',
    ])
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
    renderNav(signedInAs('member'))

    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))

    expect((await screen.findByRole('link', { name: /Rideshares/ })).getAttribute('href')).toBe('/rides')
  })

  it('is offered on a phone as well, where the bar is fullest', () => {
    onAPhone()
    renderNav(signedInAs('member'))

    expect(screen.getByRole('button', { name: 'Menu' })).toBeTruthy()
  })

  it('is not offered to somebody who may open none of it', () => {
    // Rideshares is `requireApproved`, so for a signed-out visitor ☰ would open onto
    // one link to a page that refuses them.
    renderNav({ status: 'signed-out' })

    expect(screen.queryByRole('button', { name: 'Menu' })).toBeNull()
  })
})

describe('the nav on a phone', () => {
  /**
   * The six pages, by the accessible name they carry in both layouts.
   *
   * The bar draws them as emoji, so `aria-label` is the only name there — which is
   * the point of naming them: an icon bar nobody can read is six identical buttons.
   */
  const pages = ['Feed', 'Members', 'Schedule', 'Leads', 'Meals', 'FAQ']

  const inTheBottomBar = () =>
    [...screen.getByRole('navigation', { name: 'Pages' }).querySelectorAll('a')].map((link) =>
      link.getAttribute('aria-label'),
    )

  const inTheTopBar = () =>
    [...screen.getByRole('navigation', { name: 'Main' }).querySelectorAll('a')].map(
      (link) => link.getAttribute('aria-label') ?? link.textContent,
    )

  it('moves the pages to a bar along the bottom', () => {
    onAPhone()
    renderNav(signedInAs('member'))

    expect(inTheBottomBar()).toEqual(pages)
  })

  it('leaves the topbar what is about the session rather than a page', () => {
    // Nine entries do not fit a phone, which is the whole of #337: the six pages go
    // down, and the bell, ⚙️ and the face — none of which is a page — stay up.
    onAPhone()
    renderNav(signedInAs('admin', 'member'))

    const top = inTheTopBar()
    for (const label of pages) expect(top, `${label} should have moved down`).not.toContain(label)
    for (const label of ['Notifications', 'Organise', 'Your details']) {
      expect(top, `${label} should have stayed up`).toContain(label)
    }
  })

  it('keeps the words where there is room for them', () => {
    // The success path the two above cannot show: a wide viewport is unchanged, and
    // there is no second copy of any link hiding in a bar nobody can see.
    onADesktop()
    renderNav(signedInAs('member'))

    for (const label of pages) expect(inTheTopBar(), `${label} should be in the bar`).toContain(label)
    expect(screen.queryByRole('navigation', { name: 'Pages' })).toBeNull()
  })

  it('starts the bar shown, whatever it does on a scroll', () => {
    // The half a unit test can hold: happy-dom lays nothing out, so no scroll here is
    // distinguishable from being at the end of a page — `viewport.test.ts` has the
    // arithmetic, and the bar arriving hidden is the failure that would matter most.
    onAPhone()
    renderNav(signedInAs('member'))

    expect(screen.getByRole('navigation', { name: 'Pages' }).className).toBe('bottom-bar')
  })

  it('gives a signed-out visitor no bottom bar at all', () => {
    // Apply and Log in are two entries, which fit — and a bar of six pages none of
    // them may open would be six refusals.
    onAPhone()
    renderNav({ status: 'signed-out' })

    expect(screen.queryByRole('navigation', { name: 'Pages' })).toBeNull()
    expect(inTheTopBar()).toContain('Apply')
  })

  it('gives an account with no roles none either', () => {
    // An applicant waiting on a decision, and the case where a leak would matter.
    onAPhone()
    renderNav(signedInAs())

    expect(screen.queryByRole('navigation', { name: 'Pages' })).toBeNull()
  })
})

describe('the brand', () => {
  it('wears the installation icon rather than a flame written into the bar', () => {
    // The route answers with the uploaded icon or the app's own mark, so the header
    // and the home screen cannot end up showing different things.
    renderNav(signedInAs('member'))

    const mark = document.querySelector('img.brand-mark')
    expect(mark?.getAttribute('src')).toBe(apiRoutes.getInstallationIcon.path())
    // Decorative: the name is beside it, and a second reading of it is noise.
    expect(mark?.getAttribute('alt')).toBe('')
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
    // `'🌟ada'[0]` is a lone high surrogate, which renders as �. Measured, not
    // assumed: this is what a name starting outside the basic plane produces.
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
