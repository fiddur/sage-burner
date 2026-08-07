import { cleanup, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AppApi } from './app.tsx'
import type { Viewer } from './viewer.tsx'

import { App } from './app.tsx'

/**
 * A stub satisfying exactly what `App` declares it needs — a plain object, no
 * cast.
 *
 * This was `as unknown as ApiClient`, which is the double cast the standards
 * are aimed at: through `unknown` the object stops being checked against the
 * type at all, so it would have survived `App` calling a method the stub does
 * not have.
 *
 * Every entry rejects except `getActiveEvent`, so a test that comes to depend on
 * one fails loudly instead of quietly reading an empty result and asserting
 * against it. `getActiveEvent` is the single exception because `Home` fetches it
 * on mount, so it is called by every `renderAt` here — rejecting would drive
 * `Home`'s failure branch through the whole routing suite, which is not what
 * those tests are about.
 *
 * The exception is meant to stay a single one: a stub added for a route this
 * file never visits should reject, or the first test that does visit it gets an
 * empty screen instead of the failure this convention exists to produce.
 */
const clientWith = (
  logout: AppApi['logout'] = () => Promise.reject(new Error('logout is not stubbed in this file')),
): AppApi => ({
  logout,
  getMe: () => Promise.reject(new Error('getMe is not stubbed in this file')),
  login: () => Promise.reject(new Error('login is not stubbed in this file')),
  getAdminAccounts: () => Promise.reject(new Error('getAdminAccounts is not stubbed in this file')),
  setAccountRoles: () => Promise.reject(new Error('setAccountRoles is not stubbed in this file')),
  setAccountPassword: () => Promise.reject(new Error('setAccountPassword is not stubbed in this file')),
  setMyAvatar: () => Promise.reject(new Error('setMyAvatar is not stubbed in this file')),
  removeMyAvatar: () => Promise.reject(new Error('removeMyAvatar is not stubbed in this file')),
  setInstallationIcon: () => Promise.reject(new Error('setInstallationIcon is not stubbed in this file')),
  removeInstallationIcon: () =>
    Promise.reject(new Error('removeInstallationIcon is not stubbed in this file')),
  setInstallationBanner: () => Promise.reject(new Error('setInstallationBanner is not stubbed in this file')),
  removeInstallationBanner: () =>
    Promise.reject(new Error('removeInstallationBanner is not stubbed in this file')),
  getMailSettings: () => Promise.reject(new Error('getMailSettings is not stubbed in this file')),
  getFaq: () => Promise.reject(new Error('getFaq is not stubbed in this file')),
  getFeed: () => Promise.reject(new Error('getFeed is not stubbed in this file')),
  addFaqEntry: () => Promise.reject(new Error('addFaqEntry is not stubbed in this file')),
  updateFaqEntry: () => Promise.reject(new Error('updateFaqEntry is not stubbed in this file')),
  deleteFaqEntry: () => Promise.reject(new Error('deleteFaqEntry is not stubbed in this file')),
  reorderFaq: () => Promise.reject(new Error('reorderFaq is not stubbed in this file')),
  getFaqSources: () => Promise.reject(new Error('getFaqSources is not stubbed in this file')),
  copyFaq: () => Promise.reject(new Error('copyFaq is not stubbed in this file')),
  updateMailSettings: () => Promise.reject(new Error('updateMailSettings is not stubbed in this file')),
  removeMailSettings: () => Promise.reject(new Error('removeMailSettings is not stubbed in this file')),
  sendTestEmail: () => Promise.reject(new Error('sendTestEmail is not stubbed in this file')),
  getQuestions: () => Promise.reject(new Error('getQuestions is not stubbed in this file')),
  submitApplication: () => Promise.reject(new Error('submitApplication is not stubbed in this file')),
  getApplications: () => Promise.reject(new Error('getApplications is not stubbed in this file')),
  getActiveRoster: () => Promise.reject(new Error('getActiveRoster is not stubbed in this file')),
  getMembers: () => Promise.reject(new Error('getMembers is not stubbed in this file')),
  setPayment: () => Promise.reject(new Error('setPayment is not stubbed in this file')),
  getMyBurns: () => Promise.reject(new Error('getMyBurns is not stubbed in this file')),
  getMyProfile: () => Promise.reject(new Error('getMyProfile is not stubbed in this file')),
  updateMyProfile: () => Promise.reject(new Error('updateMyProfile is not stubbed in this file')),
  updateMyStay: () => Promise.reject(new Error('updateMyStay is not stubbed in this file')),
  joinEvent: () => Promise.reject(new Error('joinEvent is not stubbed in this file')),
  leaveEvent: () => Promise.reject(new Error('leaveEvent is not stubbed in this file')),
  transferMyPlace: () => Promise.reject(new Error('transferMyPlace is not stubbed in this file')),
  getInviteState: () => Promise.reject(new Error('getInviteState is not stubbed in this file')),
  redeemInvite: () => Promise.reject(new Error('redeemInvite is not stubbed in this file')),
  getInvites: () => Promise.reject(new Error('getInvites is not stubbed in this file')),
  createInvite: () => Promise.reject(new Error('createInvite is not stubbed in this file')),
  revokeInvite: () => Promise.reject(new Error('revokeInvite is not stubbed in this file')),
  approveApplication: () => Promise.reject(new Error('approveApplication is not stubbed in this file')),
  reissueInvite: () => Promise.reject(new Error('reissueInvite is not stubbed in this file')),
  rejectApplication: () => Promise.reject(new Error('rejectApplication is not stubbed in this file')),
  addQuestion: () => Promise.reject(new Error('addQuestion is not stubbed in this file')),
  updateQuestion: () => Promise.reject(new Error('updateQuestion is not stubbed in this file')),
  deleteQuestion: () => Promise.reject(new Error('deleteQuestion is not stubbed in this file')),
  reorderQuestions: () => Promise.reject(new Error('reorderQuestions is not stubbed in this file')),
  startPasskeyRegistration: () =>
    Promise.reject(new Error('startPasskeyRegistration is not stubbed in this file')),
  addPasskey: () => Promise.reject(new Error('addPasskey is not stubbed in this file')),
  getMyPasskeys: () => Promise.reject(new Error('getMyPasskeys is not stubbed in this file')),
  removePasskey: () => Promise.reject(new Error('removePasskey is not stubbed in this file')),
  adminAddAttendance: () => Promise.reject(new Error('adminAddAttendance is not stubbed in this file')),
  // Resolves rather than rejecting: the version watcher runs on every route in this
  // file, and a rejection is swallowed anyway — being offline is not a new version.
  getVersion: () => Promise.resolve({ build_sha: 'the-one-this-page-loaded' }),
  getChangelog: () => Promise.resolve({ markdown: '## 2026-08-07\n\n- Something changed.\n' }),
  getMyNotifications: () => Promise.resolve({ notifications: [], unseen: 0 }),
  getMyNotificationSettings: () => Promise.resolve({ on: [], email: [] }),
  updateMyNotificationSettings: () =>
    Promise.reject(new Error('updateMyNotificationSettings is not stubbed here')),
  markNotificationsSeen: () => Promise.reject(new Error('markNotificationsSeen is not stubbed in this file')),

  startPasskeyLogin: () => Promise.reject(new Error('startPasskeyLogin is not stubbed in this file')),
  finishPasskeyLogin: () => Promise.reject(new Error('finishPasskeyLogin is not stubbed in this file')),
  getEvents: () => Promise.reject(new Error('getEvents is not stubbed in this file')),
  createEvent: () => Promise.reject(new Error('createEvent is not stubbed in this file')),
  updateEvent: () => Promise.reject(new Error('updateEvent is not stubbed in this file')),
  getActiveEvent: () => Promise.resolve({ event: null }),
  getAllergyItems: () => Promise.resolve({ items: [] }),
  addAllergyItem: () => Promise.reject(new Error('addAllergyItem is not stubbed in this file')),
  updateAllergyItem: () => Promise.reject(new Error('updateAllergyItem is not stubbed in this file')),
  deleteAllergyItem: () => Promise.reject(new Error('deleteAllergyItem is not stubbed in this file')),
  reorderAllergyItems: () => Promise.reject(new Error('reorderAllergyItems is not stubbed in this file')),
  getPlaces: () => Promise.reject(new Error('getPlaces is not stubbed in this file')),
  addPlace: () => Promise.reject(new Error('addPlace is not stubbed in this file')),
  updatePlace: () => Promise.reject(new Error('updatePlace is not stubbed in this file')),
  deletePlace: () => Promise.reject(new Error('deletePlace is not stubbed in this file')),
  reorderPlaces: () => Promise.reject(new Error('reorderPlaces is not stubbed in this file')),
  getPlaceSources: () => Promise.reject(new Error('getPlaceSources is not stubbed in this file')),
  copyPlaces: () => Promise.reject(new Error('copyPlaces is not stubbed in this file')),
  getEventOptions: () => Promise.reject(new Error('getEventOptions is not stubbed in this file')),
  addEventOption: () => Promise.reject(new Error('addEventOption is not stubbed in this file')),
  updateEventOption: () => Promise.reject(new Error('updateEventOption is not stubbed in this file')),
  deleteEventOption: () => Promise.reject(new Error('deleteEventOption is not stubbed in this file')),
  reorderEventOptions: () => Promise.reject(new Error('reorderEventOptions is not stubbed in this file')),
  getEventAttendees: () => Promise.reject(new Error('getEventAttendees is not stubbed in this file')),
  getLeadRoles: () => Promise.reject(new Error('getLeadRoles is not stubbed in this file')),
  getLeadRoleSources: () => Promise.reject(new Error('getLeadRoleSources is not stubbed in this file')),
  addLeadRole: () => Promise.reject(new Error('addLeadRole is not stubbed in this file')),
  updateLeadRole: () => Promise.reject(new Error('updateLeadRole is not stubbed in this file')),
  deleteLeadRole: () => Promise.reject(new Error('deleteLeadRole is not stubbed in this file')),
  setLeadRoleLead: () => Promise.reject(new Error('setLeadRoleLead is not stubbed in this file')),
  joinLeadRoleTeam: () => Promise.reject(new Error('joinLeadRoleTeam is not stubbed in this file')),
  leaveLeadRoleTeam: () => Promise.reject(new Error('leaveLeadRoleTeam is not stubbed in this file')),
  copyLeadRoles: () => Promise.reject(new Error('copyLeadRoles is not stubbed in this file')),
  getSessions: () => Promise.reject(new Error('getSessions is not stubbed in this file')),
  offerSession: () => Promise.reject(new Error('offerSession is not stubbed in this file')),
  updateSession: () => Promise.reject(new Error('updateSession is not stubbed in this file')),
  withdrawSession: () => Promise.reject(new Error('withdrawSession is not stubbed in this file')),
  getMeals: () => Promise.resolve({ intro_markdown: '', slots: [], meals: [] }),
  updateMeal: () => Promise.reject(new Error('updateMeal is not stubbed in this file')),
  setMealLead: () => Promise.reject(new Error('setMealLead is not stubbed in this file')),
  joinMealCrew: () => Promise.reject(new Error('joinMealCrew is not stubbed in this file')),
  leaveMealCrew: () => Promise.reject(new Error('leaveMealCrew is not stubbed in this file')),
  setMealIdea: () => Promise.reject(new Error('setMealIdea is not stubbed in this file')),
  updateMealIntro: () => Promise.reject(new Error('updateMealIntro is not stubbed in this file')),
  getMealSlots: () => Promise.resolve({ slots: [] }),
  addMealSlot: () => Promise.reject(new Error('addMealSlot is not stubbed in this file')),
  updateMealSlot: () => Promise.reject(new Error('updateMealSlot is not stubbed in this file')),
  deleteMealSlot: () => Promise.reject(new Error('deleteMealSlot is not stubbed in this file')),
  generateMeals: () => Promise.reject(new Error('generateMeals is not stubbed in this file')),
  addMeal: () => Promise.reject(new Error('addMeal is not stubbed in this file')),
  deleteMeal: () => Promise.reject(new Error('deleteMeal is not stubbed in this file')),
  helpWithSession: () => Promise.reject(new Error('helpWithSession is not stubbed in this file')),
  stopHelpingWithSession: () =>
    Promise.reject(new Error('stopHelpingWithSession is not stubbed in this file')),
  supportSession: () => Promise.reject(new Error('supportSession is not stubbed in this file')),
  withdrawSupportForSession: () =>
    Promise.reject(new Error('withdrawSupportForSession is not stubbed in this file')),
  getInstallation: () => Promise.reject(new Error('getInstallation is not stubbed in this file')),
  updateInstallation: () => Promise.reject(new Error('updateInstallation is not stubbed in this file')),
  updateWelcome: () => Promise.reject(new Error('updateWelcome is not stubbed in this file')),
  getPushKey: () => Promise.reject(new Error('getPushKey is not stubbed in this file')),
  subscribeToPush: () => Promise.reject(new Error('subscribeToPush is not stubbed in this file')),
  unsubscribeFromPush: () => Promise.reject(new Error('unsubscribeFromPush is not stubbed in this file')),
})

/**
 * Mounts the real `App` — its route table, its layout, its providers — rather
 * than a copy of them. A route added, removed or repointed in app.tsx must be
 * able to fail here, which a re-declared table could not do.
 */

/**
 * Signed-out by default, and always explicit — in every argument.
 *
 * `title` is here for the same reason as `viewer`: omitting it selects the
 * provider that asks the API, and the assertion below would catch the fetch.
 * Its value is deliberately not the software's name, so the homepage heading
 * and the header can only pass by reading the installation.
 *
 * Omitting `viewer` selects the provider that asks the API — which is right for
 * the app and wrong for a suite, where it would mean every render reaching for
 * `fetch`. `viewer.test.tsx` covers that provider directly with an injected
 * client.
 *
 * `api` was omitted here for the same reason it should not have been. That
 * builds a real `createApiClient()`, and once `Home` began fetching on mount,
 * `renderAt('/')` issued a genuine `fetch('/api/events/active')` — resolved by
 * happy-dom against vitest's document URL, so an actual connection to
 * `localhost:3000`, which is also the dev proxy target. On a machine with the
 * backend running, this unit suite was talking to the live API. Nothing failed,
 * because `Home` catches and the unmount abort swallowed the late `setState` —
 * which is why it went unnoticed rather than why it was fine.
 */
const renderAt = (path: string, viewer: Viewer = { status: 'signed-out' }) => {
  window.history.replaceState(null, '', path)

  return render(<App viewer={viewer} title="The Burning Sage" api={clientWith()} />)
}

/**
 * The network is closed to this file, and the closure is checked.
 *
 * Stubbing `api` fixes today's leak; this fails the *next* one — a route added
 * to `app.tsx` that fetches on mount, a component reaching past its injected
 * client. Both would otherwise reproduce exactly the silence described above.
 *
 * It has to be an assertion rather than only a rejecting stub, because the
 * pages catch their own fetch failures: a stub that rejects is indistinguishable
 * to the suite from one that is never called.
 */
let fetches: string[] = []

beforeEach(() => {
  fetches = []
  vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    fetches.push(String(input instanceof Request ? input.url : input))
    return Promise.reject(new Error('the unit suite must not reach the network'))
  })
})

afterEach(() => {
  // Explicit because the library's automatic cleanup only registers itself
  // when vitest globals are on, and they are off here. Without it every render
  // stacks in the same document and the nav assertions below see links from
  // earlier tests.
  cleanup()
  window.history.replaceState(null, '', '/')

  // After `cleanup()`, so a request fired during unmount counts too.
  const attempted = fetches
  vi.restoreAllMocks()
  expect(attempted).toEqual([])
})

describe('routing', () => {
  it('renders the home page at the root', () => {
    renderAt('/')

    // The homepage's own invitation to apply, which the nav's shorter "Apply" is not.
    // Its `h1` is the burn's name now (#306), and this file's client never answers
    // with a burn — the installation's name is in the bar, asserted below.
    expect(screen.getByRole('link', { name: 'Apply to join' })).toBeTruthy()
  })

  it('routes every page the app links to, from the nav and the admin landing page', () => {
    // A page can exist, be tested, and still be unreachable because no route
    // names it — which is what happened to /admin/applications.
    //
    // The paths come from the links the landing page renders rather than a list
    // here: a hand-written list goes stale the moment someone adds a link, which
    // is the same failure one level up.
    const admin = {
      status: 'signed-in',
      account: { id: 'a1', name: null, avatar: null, roles: ['admin', 'member'] },
    } as const
    const { container } = renderAt('/admin', admin)
    // Every link the nav offers, too: `/profile` and `/schedule` sat there for
    // pages that were never routed, so a member clicking them got NotFound.
    const navPaths = [...container.querySelectorAll('nav a[href^="/"]')].map((link) =>
      link.getAttribute('href'),
    )
    // Scoped to the page, not the container: `Layout`'s nav renders its own
    // `/admin` link for an admin, so scraping the whole tree would satisfy the
    // guard below even if the landing page had lost every link on it.
    const page = container.querySelector('section.page')
    const paths = [...(page?.querySelectorAll('a[href^="/admin"]') ?? [])].map((link) =>
      link.getAttribute('href'),
    )

    expect(paths.length).toBeGreaterThan(0)

    for (const path of ['/admin', ...[...paths, ...navPaths].filter((href) => href !== null)]) {
      cleanup()
      renderAt(path, admin)
      expect(screen.getByRole('heading', { level: 1 }).textContent, path).not.toBe('Nothing here')
    }
  })

  it('names the installation in the header, on every page', () => {
    // The header is `Layout`, which every route sits inside, so this is the one
    // place the name has to be right — and it is the software's name that used
    // to be hardcoded there.
    for (const path of ['/', '/login', '/no/such/page']) {
      cleanup()
      const { container } = renderAt(path)
      expect(container.querySelector('.brand-name')?.textContent, path).toBe('The Burning Sage')
    }
  })

  it('falls back to a not-found page for an unknown route', () => {
    renderAt('/no/such/page')

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Nothing here')
  })

  it('handles an invite path rather than sending it to the not-found page', () => {
    // The whole point of #17: an invite link used to fall through to NotFound,
    // which explained single-use invites because that is where people landed.
    renderAt('/invite/an-expired-token')

    expect(screen.getByRole('heading', { level: 1 }).textContent).not.toBe('Nothing here')
  })

  it('routes a base64url token, which is what the API mints', () => {
    // `app.tsx` forbids a dot in any route, because the backend tells a missing
    // asset from a client route by whether the last segment has an extension.
    // base64url has no dot, so a real token is safe — asserted rather than
    // assumed, since minting is one module away from routing.
    renderAt('/invite/tqYh-_9Zx0AbCdEfGhIjKlMnOpQrStUvWxYz012345')

    expect(screen.getByRole('heading', { level: 1 }).textContent).not.toBe('Nothing here')
  })
})

describe('signing out', () => {
  // On the details page rather than in the bar, beside the sentence naming the
  // account it ends. Rendered through `App` so the route, the layout and the viewer
  // provider are the real ones — clicking it has to actually empty the nav.
  const renderProfile = (logout: AppApi['logout']) => {
    window.history.replaceState(null, '', '/profile')

    return render(
      <App
        viewer={{ status: 'signed-in', account: { id: 'a-1', name: null, avatar: null, roles: ['member'] } }}
        title="The Burning Sage"
        api={clientWith(logout)}
      />,
    )
  }

  it('is not in the bar, where every other entry is a place', () => {
    renderAt('/', {
      status: 'signed-in',
      account: { id: 'a-1', name: null, avatar: null, roles: ['member'] },
    })

    expect(screen.queryByRole('button', { name: 'Log out' })).toBeNull()
  })

  it('clears the viewer, so the nav offers the way back in', async () => {
    const logout = vi.fn(() => Promise.resolve({ viewer: null }))
    renderProfile(logout)

    screen.getByRole('button', { name: 'Log out' }).click()

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Log out' })).toBeNull())
    expect(logout).toHaveBeenCalledTimes(1)
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toContain('Log in')
  })

  it('clears the viewer even when the logout request fails', async () => {
    // A nav still saying signed-in after a failed request is worse than one that
    // says signed-out while a stale cookie expires on its own.
    renderProfile(vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))

    screen.getByRole('button', { name: 'Log out' }).click()

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Log out' })).toBeNull())
  })
})

describe('navigation', () => {
  // ⚙️ is a glyph, so its name comes from `aria-label` rather than its text.
  const linkNames = () =>
    screen
      .getAllByRole('link')
      .map((link) => link.getAttribute('aria-label') ?? link.textContent?.trim())
      .filter((text): text is string => text !== undefined && text !== null)

  it('offers the public entry points when signed out', () => {
    renderAt('/')

    expect(linkNames()).toContain('Apply')
    expect(linkNames()).toContain('Log in')
    expect(linkNames()).not.toContain('Your burn')
    expect(linkNames()).not.toContain('Organise')
  })

  it('offers member pages once signed in, and drops the public ones', () => {
    renderAt('/', {
      status: 'signed-in',
      account: { id: 'a1', name: null, avatar: null, roles: ['member'] },
    })

    expect(linkNames()).toContain('Your details')
    expect(linkNames()).not.toContain('Log in')
    // ⚙️ is admin's alone since #184. What a member curates is reached from the
    // page it belongs to — Places from Schedule, the lodging list from Your burn.
    expect(linkNames()).not.toContain('Organise')
  })

  it('offers Organise to nobody without a role', () => {
    // An applicant checking on their application has an account and no roles, and
    // there is nothing behind the link for them.
    renderAt('/', { status: 'signed-in', account: { id: 'a1', name: null, avatar: null, roles: [] } })

    expect(linkNames()).not.toContain('Organise')
  })

  it('offers the organising pages to an admin', () => {
    renderAt('/', {
      status: 'signed-in',
      account: { id: 'a1', name: null, avatar: null, roles: ['admin', 'member'] },
    })

    expect(linkNames()).toContain('Organise')
    expect(linkNames()).toContain('Your details')
  })

  it('shows nothing role-specific while the session is still loading', () => {
    // Otherwise the nav flickers from signed-out to signed-in on every load,
    // which reads as a bug and is worse than showing less for a moment.
    renderAt('/', { status: 'loading' })

    expect(linkNames()).not.toContain('Log in')
    expect(linkNames()).not.toContain('Your details')
    expect(linkNames()).not.toContain('Organise')
  })
})
