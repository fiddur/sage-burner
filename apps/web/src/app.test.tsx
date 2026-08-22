import { apiRoutes } from '@sage-burner/shared'
import { cleanup, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AppApi } from './app.tsx'
import type { Viewer } from './viewer.tsx'

import { App } from './app.tsx'

const clientWith = (
  logout: AppApi['logout'] = () => Promise.reject(new Error('logout is not stubbed in this file')),
): AppApi => ({
  logout,
  getMe: () => Promise.reject(new Error('getMe is not stubbed in this file')),
  requestPasswordReset: () => Promise.reject(new Error('requestPasswordReset is not stubbed in this file')),
  getPasswordResetState: () => Promise.reject(new Error('getPasswordResetState is not stubbed in this file')),
  resetPassword: () => Promise.reject(new Error('resetPassword is not stubbed in this file')),
  readAt: () => undefined,
  markTargetShown: () => Promise.reject(new Error('markTargetShown is not stubbed in this file')),
  deleteMyNotification: () => Promise.reject(new Error('deleteMyNotification is not stubbed in this file')),
  getMapLink: () => Promise.reject(new Error('getMapLink is not stubbed in this file')),
  signUp: () => Promise.reject(new Error('signUp is not stubbed in this file')),
  sendMyApplicationMessage: () =>
    Promise.reject(new Error('sendMyApplicationMessage is not stubbed in this file')),
  getApplicationMessages: () =>
    Promise.reject(new Error('getApplicationMessages is not stubbed in this file')),
  sendApplicationMessage: () =>
    Promise.reject(new Error('sendApplicationMessage is not stubbed in this file')),
  getMyApplication: () => Promise.reject(new Error('getMyApplication is not stubbed in this file')),
  setThreadFollow: () => Promise.reject(new Error('setThreadFollow is not stubbed in this file')),
  supportThread: () => Promise.reject(new Error('supportThread is not stubbed in this file')),
  withdrawSupportForThread: () =>
    Promise.reject(new Error('withdrawSupportForThread is not stubbed in this file')),
  setMapLink: () => Promise.reject(new Error('setMapLink is not stubbed in this file')),
  getThread: () => Promise.reject(new Error('getThread is not stubbed in this file')),
  getApprovedAccounts: () => Promise.reject(new Error('getApprovedAccounts is not stubbed in this file')),
  getSongbook: () => Promise.reject(new Error('getSongbook is not stubbed in this file')),
  getSong: () => Promise.reject(new Error('getSong is not stubbed in this file')),
  addSong: () => Promise.reject(new Error('addSong is not stubbed in this file')),
  updateSong: () => Promise.reject(new Error('updateSong is not stubbed in this file')),
  deleteSong: () => Promise.reject(new Error('deleteSong is not stubbed in this file')),
  restoreSong: () => Promise.reject(new Error('restoreSong is not stubbed in this file')),
  getSongCategories: () => Promise.reject(new Error('getSongCategories is not stubbed in this file')),
  addSongCategory: () => Promise.reject(new Error('addSongCategory is not stubbed in this file')),
  updateSongCategory: () => Promise.reject(new Error('updateSongCategory is not stubbed in this file')),
  deleteSongCategory: () => Promise.reject(new Error('deleteSongCategory is not stubbed in this file')),
  reorderSongCategories: () => Promise.reject(new Error('reorderSongCategories is not stubbed in this file')),
  uploadImage: () => Promise.reject(new Error('uploadImage is not stubbed in this file')),
  getCalendarToken: () => Promise.resolve({ token: 'feed-token' }),
  rotateCalendarToken: () => Promise.reject(new Error('rotateCalendarToken is not stubbed in this file')),
  getMyImages: () => Promise.resolve({ images: [] }),
  removeMyImage: () => Promise.reject(new Error('removeMyImage is not stubbed in this file')),
  getAccountProfile: () => Promise.reject(new Error('getAccountProfile is not stubbed in this file')),
  getPrivacy: () => Promise.resolve({ markdown: '' }),
  getTerms: () => Promise.resolve({ markdown: '' }),
  getMyIdentities: () => Promise.resolve({ identities: [] }),
  removeMyIdentity: () => Promise.reject(new Error('removeMyIdentity is not stubbed in this file')),
  getOauthSettings: () => Promise.resolve({ settings: null }),
  updateOauthSettings: () => Promise.reject(new Error('updateOauthSettings is not stubbed in this file')),
  removeOauthSettings: () => Promise.reject(new Error('removeOauthSettings is not stubbed in this file')),
  getMyConnections: () => Promise.resolve({ connections: [] }),
  addMyConnection: () => Promise.reject(new Error('addMyConnection is not stubbed in this file')),
  updateMyConnection: () => Promise.reject(new Error('updateMyConnection is not stubbed in this file')),
  removeMyConnection: () => Promise.reject(new Error('removeMyConnection is not stubbed in this file')),
  reorderMyConnections: () => Promise.reject(new Error('reorderMyConnections is not stubbed in this file')),
  postComment: () => Promise.reject(new Error('postComment is not stubbed in this file')),
  updateComment: () => Promise.reject(new Error('updateComment is not stubbed in this file')),
  deleteComment: () => Promise.reject(new Error('deleteComment is not stubbed in this file')),
  supportComment: () => Promise.reject(new Error('supportComment is not stubbed in this file')),
  withdrawSupportForComment: () =>
    Promise.reject(new Error('withdrawSupportForComment is not stubbed in this file')),
  login: () => Promise.reject(new Error('login is not stubbed in this file')),
  getAdminAccounts: () => Promise.reject(new Error('getAdminAccounts is not stubbed in this file')),
  getAdminAccount: () => Promise.reject(new Error('getAdminAccount is not stubbed in this file')),
  updateAdminAccount: () => Promise.reject(new Error('updateAdminAccount is not stubbed in this file')),
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
  sendDigestPreview: () => Promise.reject(new Error('sendDigestPreview is not stubbed in this file')),
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
  createGroupInvite: () => Promise.reject(new Error('createGroupInvite is not stubbed here')),
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
  getVersion: () => Promise.resolve({ build_sha: 'the-one-this-page-loaded' }),
  getChangelog: () => Promise.resolve({ markdown: '## 2026-08-07\n\n- Something changed.\n' }),
  getMyNotifications: () => Promise.resolve({ notifications: [], unseen: 0 }),
  getNotificationLog: () => Promise.resolve({ entries: [] }),
  getMeetingPoints: () => Promise.resolve({ points: [] }),
  addMeetingPoint: () => Promise.reject(new Error('addMeetingPoint is not stubbed here')),
  updateMeetingPoint: () => Promise.reject(new Error('updateMeetingPoint is not stubbed here')),
  deleteMeetingPoint: () => Promise.reject(new Error('deleteMeetingPoint is not stubbed here')),
  decidePoint: () => Promise.reject(new Error('decidePoint is not stubbed here')),
  getMeetings: () => Promise.resolve({ meetings: [] }),
  addMeeting: () => Promise.reject(new Error('addMeeting is not stubbed here')),
  updateMeeting: () => Promise.reject(new Error('updateMeeting is not stubbed here')),
  deleteMeeting: () => Promise.reject(new Error('deleteMeeting is not stubbed here')),
  getMyNotificationSettings: () => Promise.resolve({ on: [], email: [], digest: 'daily' }),
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
  getRides: () => Promise.reject(new Error('getRides is not stubbed in this file')),
  addPost: () => Promise.reject(new Error('addPost is not stubbed in this file')),
  updatePost: () => Promise.reject(new Error('updatePost is not stubbed in this file')),
  deletePost: () => Promise.reject(new Error('deletePost is not stubbed in this file')),
  addRide: () => Promise.reject(new Error('addRide is not stubbed in this file')),
  updateRide: () => Promise.reject(new Error('updateRide is not stubbed in this file')),
  deleteRide: () => Promise.reject(new Error('deleteRide is not stubbed in this file')),
  getBringList: () => Promise.reject(new Error('getBringList is not stubbed in this file')),
  addBringItem: () => Promise.reject(new Error('addBringItem is not stubbed in this file')),
  updateBringItem: () => Promise.reject(new Error('updateBringItem is not stubbed in this file')),
  deleteBringItem: () => Promise.reject(new Error('deleteBringItem is not stubbed in this file')),
  bringThis: () => Promise.reject(new Error('bringThis is not stubbed in this file')),
  stopBringingThis: () => Promise.reject(new Error('stopBringingThis is not stubbed in this file')),
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
  restoreSession: () => Promise.reject(new Error('restoreSession is not stubbed in this file')),
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

const renderAt = (path: string, viewer: Viewer = { status: 'signed-out' }, over: Partial<AppApi> = {}) => {
  window.history.replaceState(null, '', path)

  return render(<App viewer={viewer} title="The Burning Sage" api={{ ...clientWith(), ...over }} />)
}

let fetches: string[] = []

beforeEach(() => {
  fetches = []
  vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    fetches.push(String(input instanceof Request ? input.url : input))
    return Promise.reject(new Error('the unit suite must not reach the network'))
  })
})

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')

  const attempted = fetches
  vi.restoreAllMocks()
  expect(attempted).toEqual([])
})

describe('routing', () => {
  it('renders the home page at the root', () => {
    renderAt('/')

    expect(screen.getByRole('link', { name: 'Apply to join' })).toBeTruthy()
  })

  it('routes every page the app links to, from the nav and the admin landing page', () => {
    const admin = {
      status: 'signed-in',
      account: { id: 'a1', name: null, avatar: null, roles: ['admin', 'member'] },
    } as const
    const { container } = renderAt('/admin', admin)
    const navPaths = [...container.querySelectorAll('nav a[href^="/"]')].map((link) =>
      link.getAttribute('href'),
    )
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
    for (const path of ['/', '/login', '/no/such/page']) {
      cleanup()
      const { container } = renderAt(path)
      expect(container.querySelector('.brand-name')?.textContent, path).toBe('The Burning Sage')
    }
  })

  it('leaves a link the backend serves to the browser, rather than routing it', async () => {
    renderAt('/')
    const link = document.createElement('a')
    link.href = apiRoutes.startOauthLink.path('facebook')
    link.textContent = 'Link it'
    document.body.append(link)
    const swallow = (event: Event) => event.preventDefault()
    addEventListener('click', swallow)

    try {
      link.click()

      await waitFor(() =>
        expect(screen.getByRole('heading', { level: 1 }).textContent).not.toBe('Nothing here'),
      )
    } finally {
      removeEventListener('click', swallow)
      link.remove()
    }
  })

  it('falls back to a not-found page for an unknown route', () => {
    renderAt('/no/such/page')

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Nothing here')
  })

  it('handles an invite path rather than sending it to the not-found page', () => {
    renderAt('/invite/an-expired-token')

    expect(screen.getByRole('heading', { level: 1 }).textContent).not.toBe('Nothing here')
  })

  it('routes a base64url token, which is what the API mints', () => {
    renderAt('/invite/tqYh-_9Zx0AbCdEfGhIjKlMnOpQrStUvWxYz012345')

    expect(screen.getByRole('heading', { level: 1 }).textContent).not.toBe('Nothing here')
  })
})

describe('signing out', () => {
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
    renderProfile(vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))

    screen.getByRole('button', { name: 'Log out' }).click()

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Log out' })).toBeNull())
  })
})

describe('navigation', () => {
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
    expect(linkNames()).not.toContain('Organise')
  })

  it('offers Organise to nobody without a role', () => {
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
    renderAt('/', { status: 'loading' })

    expect(linkNames()).not.toContain('Log in')
    expect(linkNames()).not.toContain('Your details')
    expect(linkNames()).not.toContain('Organise')
  })
})

describe('seeing a notification’s target (#527)', () => {
  const MEMBER: Viewer = {
    status: 'signed-in',
    account: { id: 'a1', name: 'Ada', avatar: null, roles: ['member'] },
  }

  const READ_AT = '2026-08-12T10:00:00.000Z'

  const aNotification = () => ({
    id: 'n-1',
    category: 'new_version' as const,
    body: 'A new version is out',
    link: '/changelog',
    created_at: '2026-08-12T09:00:00.000Z',
    seen_at: null,
  })

  it('tells the server the page was shown, with the moment its data was read', async () => {
    const markTargetShown = vi.fn<AppApi['markTargetShown']>(() =>
      Promise.resolve({ notifications: [{ ...aNotification(), seen_at: READ_AT }], unseen: 0 }),
    )
    renderAt('/changelog', MEMBER, {
      readAt: () => READ_AT,
      markTargetShown,
      getMyNotifications: () => Promise.resolve({ notifications: [aNotification()], unseen: 1 }),
    })

    await waitFor(() => expect(markTargetShown).toHaveBeenCalledWith({ link: '/changelog', as_of: READ_AT }))
  })

  it('stops the bell badging what has just been read, without waiting for its next ask', async () => {
    renderAt('/changelog', MEMBER, {
      readAt: () => READ_AT,
      markTargetShown: () => Promise.resolve({ notifications: [], unseen: 0 }),
      getMyNotifications: () => Promise.resolve({ notifications: [aNotification()], unseen: 1 }),
    })

    await screen.findByRole('link', { name: 'Notifications, 1 new' })
    await waitFor(() => expect(screen.getByRole('link', { name: 'Notifications' })).toBeTruthy())
  })

  it('says nothing for a signed-out visit, there being nobody to mark it for', async () => {
    const markTargetShown = vi.fn<AppApi['markTargetShown']>(() =>
      Promise.resolve({ notifications: [], unseen: 0 }),
    )
    renderAt('/changelog', { status: 'signed-out' }, { readAt: () => READ_AT, markTargetShown })

    await screen.findByRole('heading', { name: "What's new" })
    expect(markTargetShown).not.toHaveBeenCalled()
  })

  it('says nothing where the read carried no server date to claim', async () => {
    const markTargetShown = vi.fn<AppApi['markTargetShown']>(() =>
      Promise.resolve({ notifications: [], unseen: 0 }),
    )
    renderAt('/changelog', MEMBER, { readAt: () => undefined, markTargetShown })

    await screen.findByRole('heading', { name: "What's new" })
    expect(markTargetShown).not.toHaveBeenCalled()
  })

  it('does not break the page when the report fails', async () => {
    renderAt('/changelog', MEMBER, {
      readAt: () => READ_AT,
      markTargetShown: () => Promise.reject(new Error('offline')),
    })

    expect(await screen.findByText('Something changed.')).toBeTruthy()
  })
})
