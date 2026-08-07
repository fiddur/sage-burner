import type { AccountRole, MyBurn } from '@sage-burner/shared'

import { apiRoutes } from '@sage-burner/shared'
import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'

import { BurnProvider } from '../burn.tsx'
import { initials } from '../initials.ts'
import { InstallationProvider } from '../installation.tsx'
import { ViewerProvider } from '../viewer.tsx'
import { Layout } from './Layout.tsx'

afterEach(cleanup)

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

    expectLinks(['Apply', 'Log in'], ['Members', 'Schedule', 'Leads', 'Your details', 'Organise'])
  })

  it('gives a member their own pages and the shared ones', () => {
    renderNav(signedInAs('member'))

    // "Your burn" is not among them: the burns are sections of the details page
    // now, since more than one is planned at a time and the singular was from when
    // there was only ever the next one (#184).
    expectLinks(['Members', 'Schedule', 'Leads', 'Your details'], ['Your burn'])
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

    expectLinks(['Members', 'Schedule', 'Leads', 'Organise'], ['Your burn', 'Your details'])
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

    expectLinks([], ['Your burn', 'Members', 'Dreams', 'Schedule', 'Leads', 'Your details', 'Organise'])
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
