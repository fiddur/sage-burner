import type {
  ActiveEventResponse,
  AdminAccountResponse,
  AdminAccountsResponse,
  AdminInvitesResponse,
  AllergyItem,
  AllergyItemsResponse,
  ApplicationDecisionResponse,
  ApplicationResponse,
  ApplicationsResponse,
  ApprovedAccountsResponse,
  AttendanceResponse,
  BodyOf,
  CalendarFeedResponse,
  ChangelogResponse,
  ConnectionResponse,
  ConnectionsResponse,
  CopyFrom,
  CopySourcesResponse,
  EventAttendeesResponse,
  EventOptionKind,
  EventOptionOrder,
  EventOptionResponse,
  EventOptionsResponse,
  EventResponse,
  EventsResponse,
  FaqListResponse,
  FaqResponse,
  FeedKind,
  FeedResponse,
  FormQuestionOrder,
  FormQuestionResponse,
  FormQuestionsResponse,
  IdentitiesResponse,
  ImageUploadResponse,
  InstallationResponse,
  InviteResponse,
  InviteState,
  LeadRoleLead,
  LeadRoleResponse,
  LeadRolesResponse,
  LeadRoleTeam,
  MailSettingsResponse,
  MailTestResponse,
  MealResponse,
  MealSlotsResponse,
  MealsResponse,
  MemberRosterResponse,
  MeResponse,
  MyBurnsResponse,
  MyImagesResponse,
  NotificationSettings,
  NotificationsResponse,
  OAuthSettingsResponse,
  PasskeysResponse,
  PersonProfileResponse,
  PlaceOrder,
  PlaceResponse,
  PlacesResponse,
  PostResponse,
  PrivacyResponse,
  ProfileResponse,
  PushKeyResponse,
  RedeemResponse,
  Ride,
  RidesResponse,
  RosterResponse,
  SessionResponse,
  SessionsResponse,
  SongbookResponse,
  SongCategoriesResponse,
  SongCategoryResponse,
  SongResponse,
  TermsResponse,
  ThreadResponse,
  VersionResponse,
} from '@sage-burner/shared'
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'

import { apiRoutes, feedPath } from '@sage-burner/shared'

export interface ApiError extends Error {
  status: number
  code: string
  payload?: unknown
}

export const apiError = (status: number, code: string, message: string, payload?: unknown): ApiError =>
  Object.assign(new Error(message), { name: 'ApiError', status, code, payload })

const orderBody = (ids: readonly string[]) => ({ ids: [...ids] })

export const isApiError = (value: unknown): value is ApiError =>
  value instanceof Error && 'status' in value && 'code' in value

export const inAWhile = (seconds: number): string => {
  if (seconds === 1) return 'a second'
  if (seconds <= 90) return `${seconds} seconds`

  const minutes = Math.ceil(seconds / 60)

  return minutes === 1 ? 'a minute' : `${minutes} minutes`
}

/** Whole seconds only: the header carries either those or a date, and the app only sends the first. */
export const waitFrom = (header: string | null): number | undefined => {
  const seconds = Number(header)

  return header !== null && Number.isInteger(seconds) && seconds > 0 ? seconds : undefined
}

const messageFor = (status: number, retryAfter?: number) => {
  if (status === 401) return 'You need to sign in.'
  if (status === 403) return 'You do not have access to that.'
  if (status === 429) {
    return retryAfter === undefined
      ? 'Too many attempts just now. Wait a few seconds and try again.'
      : `Too many attempts just now. Try again in ${inAWhile(retryAfter)}.`
  }
  if (status === 404) return 'Not found.'
  if (status === 412 || status === 428) {
    return 'Somebody else changed this while you had it open. It has been refreshed — have a look and try again.'
  }
  if (status >= 500) return 'Something went wrong at our end. Please try again.'
  return `Request failed (${status}).`
}

const failureFrom = async (response: Response): Promise<{ code: string; payload?: unknown }> => {
  try {
    const body: unknown = await response.json()
    if (typeof body === 'object' && body !== null && 'error' in body) {
      const { error } = body
      if (typeof error === 'string') return { code: error, payload: body }
    }
    return { code: 'unknown', payload: body }
  } catch {
    return { code: 'unknown' }
  }
}

const failureToReach = (cause: unknown): ApiError =>
  cause instanceof DOMException && cause.name === 'AbortError'
    ? apiError(0, 'aborted', 'Request cancelled.')
    : apiError(0, 'network', 'Could not reach the server. Check your connection and try again.')

export type Guarded =
  | 'active-event'
  | 'faq'
  | 'lead-roles'
  | 'meals'
  | 'options'
  | 'places'
  | 'sessions'
  | 'song'

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
  version?: Guarded
}

export interface ClientDeps {
  onRead?: (response: Response) => void
}

export const createApiClient = (doFetch: typeof fetch = globalThis.fetch, { onRead }: ClientDeps = {}) => {
  const versions = new Map<Guarded, string>()

  const precondition = (method: string, version?: Guarded): Record<string, string> => {
    const held = version === undefined ? undefined : versions.get(version)

    return method === 'GET' || held === undefined ? {} : { 'if-match': held }
  }

  const noteVersion = (response: Response, version?: Guarded) => {
    if (version === undefined) return

    const tag = response.headers.get('etag')
    if (tag !== null) versions.set(version, tag)
  }

  const request = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
    const { method = 'GET', body, signal, version } = options

    let response: Response
    const binary = body instanceof Blob
    const payload = body === undefined ? undefined : binary ? body : JSON.stringify(body)
    const contentType = binary ? body.type : 'application/json'

    try {
      response = await doFetch(path, {
        method,
        signal,
        credentials: 'same-origin',
        headers: {
          ...(payload === undefined ? {} : { 'content-type': contentType }),
          ...precondition(method, version),
        },
        body: payload,
      })
    } catch (cause) {
      throw failureToReach(cause)
    }

    noteVersion(response, version)

    if (!response.ok) {
      const failure = await failureFrom(response)
      throw apiError(
        response.status,
        failure.code,
        messageFor(response.status, waitFrom(response.headers.get('retry-after'))),
        failure.payload,
      )
    }

    if (method === 'GET') onRead?.(response)

    if (response.status === 204) return undefined as T

    let text: string
    try {
      text = await response.text()
    } catch (cause) {
      throw failureToReach(cause)
    }
    if (text.trim() === '') return undefined as T

    try {
      return JSON.parse(text) as T
    } catch {
      throw apiError(response.status, 'unparseable', messageFor(500))
    }
  }

  return {
    request,
    getVersion: () => request<VersionResponse>(apiRoutes.getVersion.path()),

    getChangelog: (signal?: AbortSignal) =>
      request<ChangelogResponse>(apiRoutes.getChangelog.path(), { signal }),

    getInstallation: (signal?: AbortSignal) =>
      request<InstallationResponse>(apiRoutes.getInstallation.path(), { signal }),

    updateInstallation: (body: BodyOf<'updateInstallation'>) =>
      request<InstallationResponse>(apiRoutes.updateInstallation.path(), {
        method: apiRoutes.updateInstallation.method,
        body,
      }),

    getMyNotifications: (signal?: AbortSignal) =>
      request<NotificationsResponse>(apiRoutes.getMyNotifications.path(), { signal }),

    markNotificationsSeen: () =>
      request<NotificationsResponse>(apiRoutes.markNotificationsSeen.path(), {
        method: apiRoutes.markNotificationsSeen.method,
      }),

    getMyNotificationSettings: (signal?: AbortSignal) =>
      request<NotificationSettings>(apiRoutes.getMyNotificationSettings.path(), { signal }),

    updateMyNotificationSettings: (body: BodyOf<'updateMyNotificationSettings'>) =>
      request<NotificationSettings>(apiRoutes.updateMyNotificationSettings.path(), {
        method: apiRoutes.updateMyNotificationSettings.method,
        body,
      }),

    getMe: (signal?: AbortSignal) => request<MeResponse>(apiRoutes.getMe.path(), { signal }),

    login: (body: BodyOf<'login'>) =>
      request<MeResponse>(apiRoutes.login.path(), { method: apiRoutes.login.method, body }),

    logout: () => request<MeResponse>(apiRoutes.logout.path(), { method: apiRoutes.logout.method }),

    startPasskeyRegistration: () =>
      request<{ options: PublicKeyCredentialCreationOptionsJSON }>(
        apiRoutes.startPasskeyRegistration.path(),
        { method: apiRoutes.startPasskeyRegistration.method },
      ),

    addPasskey: (body: BodyOf<'addPasskey'>) =>
      request<PasskeysResponse>(apiRoutes.addPasskey.path(), {
        method: apiRoutes.addPasskey.method,
        body,
      }),

    getMyPasskeys: (signal?: AbortSignal) =>
      request<PasskeysResponse>(apiRoutes.getMyPasskeys.path(), { signal }),

    removePasskey: (id: string) =>
      request<PasskeysResponse>(apiRoutes.removePasskey.path(id), {
        method: apiRoutes.removePasskey.method,
      }),

    startPasskeyLogin: () =>
      request<{ options: PublicKeyCredentialRequestOptionsJSON }>(apiRoutes.startPasskeyLogin.path(), {
        method: apiRoutes.startPasskeyLogin.method,
      }),

    finishPasskeyLogin: (body: BodyOf<'finishPasskeyLogin'>) =>
      request<MeResponse>(apiRoutes.finishPasskeyLogin.path(), {
        method: apiRoutes.finishPasskeyLogin.method,
        body,
      }),

    getAdminAccounts: (signal?: AbortSignal) =>
      request<AdminAccountsResponse>(apiRoutes.getAdminAccounts.path(), { signal }),

    getActiveEvent: (signal?: AbortSignal) =>
      request<ActiveEventResponse>(apiRoutes.getActiveEvent.path(), { signal, version: 'active-event' }),

    setAccountRoles: (accountId: string, body: BodyOf<'setAccountRoles'>) =>
      request<AdminAccountResponse>(apiRoutes.setAccountRoles.path(accountId), {
        method: apiRoutes.setAccountRoles.method,
        body,
      }),

    setAccountPassword: (accountId: string, body: BodyOf<'setAccountPassword'>) =>
      request<undefined>(apiRoutes.setAccountPassword.path(accountId), {
        method: apiRoutes.setAccountPassword.method,
        body,
      }),

    getMeals: (eventId: string, signal?: AbortSignal) =>
      request<MealsResponse>(apiRoutes.getMeals.path(eventId), { signal, version: 'meals' }),

    updateMeal: (id: string, body: BodyOf<'updateMeal'>) =>
      request<MealResponse>(apiRoutes.updateMeal.path(id), {
        method: apiRoutes.updateMeal.method,
        body,
        version: 'meals',
      }),

    setMealLead: (id: string, body: BodyOf<'setMealLead'>) =>
      request<MealResponse>(apiRoutes.setMealLead.path(id), { method: apiRoutes.setMealLead.method, body }),

    joinMealCrew: (id: string, role: 'cleanup' | 'helper', body: BodyOf<'joinMealCrew'>) =>
      request<MealResponse>(apiRoutes.joinMealCrew.path(id, role), {
        method: apiRoutes.joinMealCrew.method,
        body,
      }),

    leaveMealCrew: (id: string, role: 'cleanup' | 'helper', accountId: string) =>
      request<MealResponse>(apiRoutes.leaveMealCrew.path(id, role, accountId), {
        method: apiRoutes.leaveMealCrew.method,
      }),

    setMealIdea: (id: string, body: BodyOf<'setMealIdea'>) =>
      request<MealResponse>(apiRoutes.setMealIdea.path(id), {
        method: apiRoutes.setMealIdea.method,
        body,
        version: 'meals',
      }),

    updateMealIntro: (eventId: string, body: BodyOf<'updateMealIntro'>) =>
      request<{ meal_intro_markdown: string }>(apiRoutes.updateMealIntro.path(eventId), {
        method: apiRoutes.updateMealIntro.method,
        body,
        version: 'meals',
      }),

    getMealSlots: (eventId: string, signal?: AbortSignal) =>
      request<MealSlotsResponse>(apiRoutes.getMealSlots.path(eventId), { signal }),

    addMealSlot: (eventId: string, body: BodyOf<'addMealSlot'>) =>
      request<MealSlotsResponse>(apiRoutes.addMealSlot.path(eventId), {
        method: apiRoutes.addMealSlot.method,
        body,
      }),

    updateMealSlot: (id: string, body: BodyOf<'updateMealSlot'>) =>
      request<MealSlotsResponse>(apiRoutes.updateMealSlot.path(id), {
        method: apiRoutes.updateMealSlot.method,
        body,
      }),

    deleteMealSlot: (id: string) =>
      request<undefined>(apiRoutes.deleteMealSlot.path(id), { method: apiRoutes.deleteMealSlot.method }),

    generateMeals: (eventId: string) =>
      request<{ meals: MealsResponse['meals'] }>(apiRoutes.generateMeals.path(eventId), {
        method: apiRoutes.generateMeals.method,
      }),

    addMeal: (eventId: string, body: BodyOf<'addMeal'>) =>
      request<MealResponse>(apiRoutes.addMeal.path(eventId), { method: apiRoutes.addMeal.method, body }),

    deleteMeal: (id: string) =>
      request<undefined>(apiRoutes.deleteMeal.path(id), { method: apiRoutes.deleteMeal.method }),

    setMyAvatar: (image: Blob) =>
      request<{ avatar: string }>(apiRoutes.setMyAvatar.path(), {
        method: apiRoutes.setMyAvatar.method,
        body: image,
      }),

    removeMyAvatar: () =>
      request<undefined>(apiRoutes.removeMyAvatar.path(), { method: apiRoutes.removeMyAvatar.method }),

    getCalendarToken: (eventId: string, signal?: AbortSignal) =>
      request<CalendarFeedResponse>(apiRoutes.getCalendarToken.path(eventId), { signal }),

    rotateCalendarToken: (eventId: string) =>
      request<CalendarFeedResponse>(apiRoutes.rotateCalendarToken.path(eventId), {
        method: apiRoutes.rotateCalendarToken.method,
      }),

    getPrivacy: (signal?: AbortSignal) => request<PrivacyResponse>(apiRoutes.getPrivacy.path(), { signal }),

    getTerms: (signal?: AbortSignal) => request<TermsResponse>(apiRoutes.getTerms.path(), { signal }),

    getMyIdentities: (signal?: AbortSignal) =>
      request<IdentitiesResponse>(apiRoutes.getMyIdentities.path(), { signal }),

    removeMyIdentity: (provider: string) =>
      request<undefined>(apiRoutes.removeMyIdentity.path(provider), {
        method: apiRoutes.removeMyIdentity.method,
      }),

    getOauthSettings: (provider: string, signal?: AbortSignal) =>
      request<OAuthSettingsResponse>(apiRoutes.getOauthSettings.path(provider), { signal }),

    updateOauthSettings: (provider: string, body: BodyOf<'updateOauthSettings'>) =>
      request<OAuthSettingsResponse>(apiRoutes.updateOauthSettings.path(provider), {
        method: apiRoutes.updateOauthSettings.method,
        body,
      }),

    removeOauthSettings: (provider: string) =>
      request<OAuthSettingsResponse>(apiRoutes.removeOauthSettings.path(provider), {
        method: apiRoutes.removeOauthSettings.method,
      }),

    getAccountProfile: (accountId: string, signal?: AbortSignal) =>
      request<PersonProfileResponse>(apiRoutes.accountProfile.path(accountId), { signal }),

    getMyConnections: (signal?: AbortSignal) =>
      request<ConnectionsResponse>(apiRoutes.getMyConnections.path(), { signal }),

    addMyConnection: (body: BodyOf<'addMyConnection'>) =>
      request<ConnectionResponse>(apiRoutes.addMyConnection.path(), {
        method: apiRoutes.addMyConnection.method,
        body,
      }),

    updateMyConnection: (id: string, body: BodyOf<'updateMyConnection'>) =>
      request<ConnectionResponse>(apiRoutes.updateMyConnection.path(id), {
        method: apiRoutes.updateMyConnection.method,
        body,
      }),

    removeMyConnection: (id: string) =>
      request<undefined>(apiRoutes.removeMyConnection.path(id), {
        method: apiRoutes.removeMyConnection.method,
      }),

    reorderMyConnections: (ids: string[]) =>
      request<ConnectionsResponse>(apiRoutes.reorderMyConnections.path(), {
        method: apiRoutes.reorderMyConnections.method,
        body: { ids },
      }),

    uploadImage: (image: Blob) =>
      request<ImageUploadResponse>(apiRoutes.uploadImage.path(), {
        method: apiRoutes.uploadImage.method,
        body: image,
      }),

    getMyImages: (signal?: AbortSignal) =>
      request<MyImagesResponse>(apiRoutes.getMyImages.path(), { signal }),

    removeMyImage: (id: string) =>
      request<undefined>(apiRoutes.removeMyImage.path(id), { method: apiRoutes.removeMyImage.method }),

    setInstallationIcon: (image: Blob) =>
      request<{ icon: string }>(apiRoutes.setInstallationIcon.path(), {
        method: apiRoutes.setInstallationIcon.method,
        body: image,
      }),

    setInstallationBanner: (image: Blob) =>
      request<{ banner: string }>(apiRoutes.setInstallationBanner.path(), {
        method: apiRoutes.setInstallationBanner.method,
        body: image,
      }),

    removeInstallationBanner: () =>
      request<undefined>(apiRoutes.removeInstallationBanner.path(), {
        method: apiRoutes.removeInstallationBanner.method,
      }),

    removeInstallationIcon: () =>
      request<undefined>(apiRoutes.removeInstallationIcon.path(), {
        method: apiRoutes.removeInstallationIcon.method,
      }),

    getMailSettings: (signal?: AbortSignal) =>
      request<MailSettingsResponse>(apiRoutes.getMailSettings.path(), { signal }),

    updateMailSettings: (body: BodyOf<'updateMailSettings'>) =>
      request<MailSettingsResponse>(apiRoutes.updateMailSettings.path(), {
        method: apiRoutes.updateMailSettings.method,
        body,
      }),

    removeMailSettings: () =>
      request<MailSettingsResponse>(apiRoutes.removeMailSettings.path(), {
        method: apiRoutes.removeMailSettings.method,
      }),

    sendTestEmail: () =>
      request<MailTestResponse>(apiRoutes.sendTestEmail.path(), {
        method: apiRoutes.sendTestEmail.method,
      }),

    getFeed: (kinds: readonly FeedKind[], signal?: AbortSignal) =>
      request<FeedResponse>(feedPath(kinds), { signal }),

    getFaq: (eventId: string, signal?: AbortSignal) =>
      request<FaqListResponse>(apiRoutes.getFaq.path(eventId), { signal, version: 'faq' }),

    addFaqEntry: (eventId: string, body: BodyOf<'addFaqEntry'>) =>
      request<FaqResponse>(apiRoutes.addFaqEntry.path(eventId), {
        method: apiRoutes.addFaqEntry.method,
        body,
      }),

    updateFaqEntry: (id: string, body: BodyOf<'updateFaqEntry'>) =>
      request<FaqResponse>(apiRoutes.updateFaqEntry.path(id), {
        method: apiRoutes.updateFaqEntry.method,
        body,
        version: 'faq',
      }),

    deleteFaqEntry: (id: string) =>
      request<undefined>(apiRoutes.deleteFaqEntry.path(id), {
        method: apiRoutes.deleteFaqEntry.method,
        version: 'faq',
      }),

    reorderFaq: (eventId: string, ids: string[]) =>
      request<FaqListResponse>(apiRoutes.reorderFaq.path(eventId), {
        method: apiRoutes.reorderFaq.method,
        body: { ids },
        version: 'faq',
      }),

    getFaqSources: (eventId: string, signal?: AbortSignal) =>
      request<CopySourcesResponse>(apiRoutes.getFaqSources.path(eventId), { signal }),

    copyFaq: (eventId: string, from_event_id: string) =>
      request<FaqListResponse>(apiRoutes.copyFaq.path(eventId), {
        method: apiRoutes.copyFaq.method,
        body: { from_event_id },
      }),

    getSessions: (eventId: string, signal?: AbortSignal) =>
      request<SessionsResponse>(apiRoutes.getSessions.path(eventId), { signal, version: 'sessions' }),

    offerSession: (eventId: string, body: BodyOf<'offerSession'>) =>
      request<SessionResponse>(apiRoutes.offerSession.path(eventId), {
        method: apiRoutes.offerSession.method,
        body,
      }),

    updateSession: (id: string, body: BodyOf<'updateSession'>) =>
      request<SessionResponse>(apiRoutes.updateSession.path(id), {
        method: apiRoutes.updateSession.method,
        body,
        version: 'sessions',
      }),

    withdrawSession: (id: string) =>
      request<undefined>(apiRoutes.withdrawSession.path(id), { method: apiRoutes.withdrawSession.method }),

    helpWithSession: (id: string, body: BodyOf<'helpWithSession'>) =>
      request<SessionResponse>(apiRoutes.helpWithSession.path(id), {
        method: apiRoutes.helpWithSession.method,
        body,
      }),

    stopHelpingWithSession: (id: string, accountId: string) =>
      request<SessionResponse>(apiRoutes.stopHelpingWithSession.path(id, accountId), {
        method: apiRoutes.stopHelpingWithSession.method,
      }),

    getThread: (id: string, signal?: AbortSignal) =>
      request<ThreadResponse>(apiRoutes.getThread.path(id), { signal }),

    postComment: (id: string, body: BodyOf<'postComment'>) =>
      request<ThreadResponse>(apiRoutes.postComment.path(id), {
        method: apiRoutes.postComment.method,
        body,
      }),

    updateComment: (id: string, body: BodyOf<'updateComment'>) =>
      request<ThreadResponse>(apiRoutes.updateComment.path(id), {
        method: apiRoutes.updateComment.method,
        body,
      }),

    deleteComment: (id: string) =>
      request<ThreadResponse>(apiRoutes.deleteComment.path(id), {
        method: apiRoutes.deleteComment.method,
      }),

    supportSession: (id: string) =>
      request<SessionResponse>(apiRoutes.supportSession.path(id), {
        method: apiRoutes.supportSession.method,
      }),

    withdrawSupportForSession: (id: string) =>
      request<SessionResponse>(apiRoutes.withdrawSupportForSession.path(id), {
        method: apiRoutes.withdrawSupportForSession.method,
      }),

    getEventAttendees: (eventId: string, signal?: AbortSignal) =>
      request<EventAttendeesResponse>(apiRoutes.getEventAttendees.path(eventId), { signal }),

    getApprovedAccounts: (signal?: AbortSignal) =>
      request<ApprovedAccountsResponse>(apiRoutes.getApprovedAccounts.path(), { signal }),

    getSongbook: (signal?: AbortSignal) =>
      request<SongbookResponse>(apiRoutes.getSongbook.path(), { signal }),

    getSong: (id: string, signal?: AbortSignal) =>
      request<SongResponse>(apiRoutes.getSong.path(id), { signal, version: 'song' }),

    addSong: (body: BodyOf<'addSong'>) =>
      request<SongResponse>(apiRoutes.addSong.path(), { method: apiRoutes.addSong.method, body }),

    updateSong: (id: string, body: BodyOf<'updateSong'>) =>
      request<SongResponse>(apiRoutes.updateSong.path(id), {
        method: apiRoutes.updateSong.method,
        body,
        version: 'song',
      }),

    deleteSong: (id: string) =>
      request<undefined>(apiRoutes.deleteSong.path(id), { method: apiRoutes.deleteSong.method }),

    restoreSong: (id: string) =>
      request<SongResponse>(apiRoutes.restoreSong.path(id), {
        method: apiRoutes.restoreSong.method,
        version: 'song',
      }),

    getSongCategories: (signal?: AbortSignal) =>
      request<SongCategoriesResponse>(apiRoutes.getSongCategories.path(), { signal }),

    addSongCategory: (body: BodyOf<'addSongCategory'>) =>
      request<SongCategoryResponse>(apiRoutes.addSongCategory.path(), {
        method: apiRoutes.addSongCategory.method,
        body,
      }),

    updateSongCategory: (id: string, body: BodyOf<'updateSongCategory'>) =>
      request<SongCategoryResponse>(apiRoutes.updateSongCategory.path(id), {
        method: apiRoutes.updateSongCategory.method,
        body,
      }),

    deleteSongCategory: (id: string) =>
      request<undefined>(apiRoutes.deleteSongCategory.path(id), {
        method: apiRoutes.deleteSongCategory.method,
      }),

    reorderSongCategories: (ids: readonly string[]) =>
      request<SongCategoriesResponse>(apiRoutes.reorderSongCategories.path(), {
        method: apiRoutes.reorderSongCategories.method,
        body: orderBody(ids) satisfies BodyOf<'reorderSongCategories'>,
      }),

    getLeadRoles: (eventId: string, signal?: AbortSignal) =>
      request<LeadRolesResponse>(apiRoutes.getLeadRoles.path(eventId), { signal, version: 'lead-roles' }),

    addLeadRole: (eventId: string, body: BodyOf<'addLeadRole'>) =>
      request<LeadRoleResponse>(apiRoutes.addLeadRole.path(eventId), {
        method: apiRoutes.addLeadRole.method,
        body,
      }),

    updateLeadRole: (id: string, body: BodyOf<'updateLeadRole'>) =>
      request<LeadRoleResponse>(apiRoutes.updateLeadRole.path(id), {
        method: apiRoutes.updateLeadRole.method,
        body,
        version: 'lead-roles',
      }),

    deleteLeadRole: (id: string) =>
      request<undefined>(apiRoutes.deleteLeadRole.path(id), { method: apiRoutes.deleteLeadRole.method }),

    setLeadRoleLead: (id: string, accountId: string | null) =>
      request<LeadRoleResponse>(apiRoutes.setLeadRoleLead.path(id), {
        method: apiRoutes.setLeadRoleLead.method,
        body: { account_id: accountId } satisfies LeadRoleLead,
      }),

    joinLeadRoleTeam: (id: string, accountId: string) =>
      request<LeadRoleResponse>(apiRoutes.joinLeadRoleTeam.path(id), {
        method: apiRoutes.joinLeadRoleTeam.method,
        body: { account_id: accountId } satisfies LeadRoleTeam,
      }),

    leaveLeadRoleTeam: (id: string, accountId: string) =>
      request<undefined>(apiRoutes.leaveLeadRoleTeam.path(id, accountId), {
        method: apiRoutes.leaveLeadRoleTeam.method,
      }),

    getLeadRoleSources: (eventId: string, signal?: AbortSignal) =>
      request<CopySourcesResponse>(apiRoutes.getLeadRoleSources.path(eventId), { signal }),

    copyLeadRoles: (eventId: string, fromEventId: string) =>
      request<LeadRolesResponse>(apiRoutes.copyLeadRoles.path(eventId), {
        method: apiRoutes.copyLeadRoles.method,
        body: { from_event_id: fromEventId } satisfies CopyFrom,
      }),

    getPlaces: (eventId: string, signal?: AbortSignal) =>
      request<PlacesResponse>(apiRoutes.getPlaces.path(eventId), { signal, version: 'places' }),

    addPlace: (eventId: string, body: BodyOf<'addPlace'>) =>
      request<PlaceResponse>(apiRoutes.addPlace.path(eventId), {
        method: apiRoutes.addPlace.method,
        body,
      }),

    updatePlace: (id: string, body: BodyOf<'updatePlace'>) =>
      request<PlaceResponse>(apiRoutes.updatePlace.path(id), {
        method: apiRoutes.updatePlace.method,
        body,
        version: 'places',
      }),

    deletePlace: (id: string) =>
      request<undefined>(apiRoutes.deletePlace.path(id), { method: apiRoutes.deletePlace.method }),

    reorderPlaces: (eventId: string, ids: readonly string[]) =>
      request<PlacesResponse>(apiRoutes.reorderPlaces.path(eventId), {
        method: apiRoutes.reorderPlaces.method,
        body: orderBody(ids) satisfies PlaceOrder,
        version: 'places',
      }),

    getPlaceSources: (eventId: string, signal?: AbortSignal) =>
      request<CopySourcesResponse>(apiRoutes.getPlaceSources.path(eventId), { signal }),

    copyPlaces: (eventId: string, fromEventId: string) =>
      request<PlacesResponse>(apiRoutes.copyPlaces.path(eventId), {
        method: apiRoutes.copyPlaces.method,
        body: { from_event_id: fromEventId } satisfies CopyFrom,
      }),

    getRides: (eventId: string, signal?: AbortSignal) =>
      request<RidesResponse>(apiRoutes.getRides.path(eventId), { signal }),

    addRide: (eventId: string, body: BodyOf<'addRide'>) =>
      request<{ ride: Ride }>(apiRoutes.addRide.path(eventId), {
        method: apiRoutes.addRide.method,
        body,
      }),

    updateRide: (id: string, body: BodyOf<'updateRide'>) =>
      request<{ ride: Ride }>(apiRoutes.updateRide.path(id), {
        method: apiRoutes.updateRide.method,
        body,
      }),

    deleteRide: (id: string) =>
      request<undefined>(apiRoutes.deleteRide.path(id), { method: apiRoutes.deleteRide.method }),

    addPost: (eventId: string, body: BodyOf<'addPost'>) =>
      request<PostResponse>(apiRoutes.addPost.path(eventId), {
        method: apiRoutes.addPost.method,
        body,
      }),

    updatePost: (id: string, body: BodyOf<'updatePost'>) =>
      request<PostResponse>(apiRoutes.updatePost.path(id), {
        method: apiRoutes.updatePost.method,
        body,
      }),

    deletePost: (id: string) =>
      request<undefined>(apiRoutes.deletePost.path(id), { method: apiRoutes.deletePost.method }),

    getEventOptions: (eventId: string, signal?: AbortSignal) =>
      request<EventOptionsResponse>(apiRoutes.getEventOptions.path(eventId), { signal, version: 'options' }),

    addEventOption: (eventId: string, body: BodyOf<'addEventOption'>) =>
      request<EventOptionResponse>(apiRoutes.addEventOption.path(eventId), {
        method: apiRoutes.addEventOption.method,
        body,
      }),

    updateEventOption: (id: string, body: BodyOf<'updateEventOption'>) =>
      request<EventOptionResponse>(apiRoutes.updateEventOption.path(id), {
        method: apiRoutes.updateEventOption.method,
        body,
        version: 'options',
      }),

    deleteEventOption: (id: string) =>
      request<undefined>(apiRoutes.deleteEventOption.path(id), {
        method: apiRoutes.deleteEventOption.method,
      }),

    reorderEventOptions: (eventId: string, kind: EventOptionKind, ids: readonly string[]) =>
      request<EventOptionsResponse>(apiRoutes.reorderEventOptions.path(eventId, kind), {
        method: apiRoutes.reorderEventOptions.method,
        body: orderBody(ids) satisfies EventOptionOrder,
        version: 'options',
      }),

    getEvents: (signal?: AbortSignal) => request<EventsResponse>(apiRoutes.getEvents.path(), { signal }),

    createEvent: (body: BodyOf<'createEvent'>) =>
      request<EventResponse>(apiRoutes.createEvent.path(), { method: apiRoutes.createEvent.method, body }),

    updateEvent: (id: string, body: BodyOf<'updateEvent'>) =>
      request<EventResponse>(apiRoutes.updateEvent.path(id), { method: apiRoutes.updateEvent.method, body }),

    updateWelcome: (id: string, body: BodyOf<'updateWelcome'>) =>
      request<EventResponse>(apiRoutes.updateWelcome.path(id), {
        method: apiRoutes.updateWelcome.method,
        body,
        version: 'active-event',
      }),

    getQuestions: (signal?: AbortSignal) =>
      request<FormQuestionsResponse>(apiRoutes.getQuestions.path(), { signal }),

    submitApplication: (body: BodyOf<'submitApplication'>) =>
      request<ApplicationResponse>(apiRoutes.submitApplication.path(), {
        method: apiRoutes.submitApplication.method,
        body,
      }),

    getInviteState: (token: string, signal?: AbortSignal) =>
      request<InviteState>(apiRoutes.getInviteState.path(token), { signal }),

    redeemInvite: (token: string, body: BodyOf<'redeemInvite'>) =>
      request<RedeemResponse>(apiRoutes.redeemInvite.path(token), {
        method: apiRoutes.redeemInvite.method,
        body,
      }),

    getMyBurns: (signal?: AbortSignal) => request<MyBurnsResponse>(apiRoutes.getMyBurns.path(), { signal }),

    adminAddAttendance: (eventId: string, body: BodyOf<'adminAddAttendance'>) =>
      request<AttendanceResponse>(apiRoutes.adminAddAttendance.path(eventId), {
        method: apiRoutes.adminAddAttendance.method,
        body,
      }),

    joinEvent: (eventId: string) =>
      request<AttendanceResponse>(apiRoutes.joinEvent.path(eventId), {
        method: apiRoutes.joinEvent.method,
      }),

    leaveEvent: (eventId: string) =>
      request<undefined>(apiRoutes.leaveEvent.path(eventId), { method: apiRoutes.leaveEvent.method }),

    transferMyPlace: (eventId: string, body: BodyOf<'transferMyPlace'>) =>
      request<undefined>(apiRoutes.transferMyPlace.path(eventId), {
        method: apiRoutes.transferMyPlace.method,
        body,
      }),

    getAllergyItems: (signal?: AbortSignal) =>
      request<AllergyItemsResponse>(apiRoutes.getAllergyItems.path(), { signal }),

    addAllergyItem: (body: BodyOf<'addAllergyItem'>) =>
      request<{ item: AllergyItem }>(apiRoutes.addAllergyItem.path(), {
        method: apiRoutes.addAllergyItem.method,
        body,
      }),

    updateAllergyItem: (id: string, body: BodyOf<'updateAllergyItem'>) =>
      request<{ item: AllergyItem }>(apiRoutes.updateAllergyItem.path(id), {
        method: apiRoutes.updateAllergyItem.method,
        body,
      }),

    deleteAllergyItem: (id: string) =>
      request<undefined>(apiRoutes.deleteAllergyItem.path(id), {
        method: apiRoutes.deleteAllergyItem.method,
      }),

    reorderAllergyItems: (ids: readonly string[]) =>
      request<AllergyItemsResponse>(apiRoutes.reorderAllergyItems.path(), {
        method: apiRoutes.reorderAllergyItems.method,
        body: orderBody(ids) satisfies BodyOf<'reorderAllergyItems'>,
      }),

    getMyProfile: (signal?: AbortSignal) =>
      request<ProfileResponse>(apiRoutes.getMyProfile.path(), { signal }),

    updateMyProfile: (body: BodyOf<'updateMyProfile'>) =>
      request<ProfileResponse>(apiRoutes.updateMyProfile.path(), {
        method: apiRoutes.updateMyProfile.method,
        body,
      }),

    updateMyStay: (eventId: string, body: BodyOf<'updateMyStay'>) =>
      request<AttendanceResponse>(apiRoutes.updateMyStay.path(eventId), {
        method: apiRoutes.updateMyStay.method,
        body,
      }),

    getActiveRoster: (signal?: AbortSignal) =>
      request<RosterResponse>(apiRoutes.getActiveRoster.path(), { signal }),

    getMembers: (eventId: string, signal?: AbortSignal) =>
      request<MemberRosterResponse>(apiRoutes.getMembers.path(eventId), { signal }),

    setPayment: (eventId: string, accountId: string, body: BodyOf<'setPayment'>) =>
      request<AttendanceResponse>(apiRoutes.setPayment.path(eventId, accountId), {
        method: apiRoutes.setPayment.method,
        body,
      }),

    getApplications: (signal?: AbortSignal) =>
      request<ApplicationsResponse>(apiRoutes.getApplications.path(), { signal }),

    approveApplication: (id: string) =>
      request<ApplicationDecisionResponse>(apiRoutes.approveApplication.path(id), {
        method: apiRoutes.approveApplication.method,
      }),

    reissueInvite: (id: string) =>
      request<InviteResponse>(apiRoutes.reissueInvite.path(id), {
        method: apiRoutes.reissueInvite.method,
      }),

    rejectApplication: (id: string) =>
      request<ApplicationDecisionResponse>(apiRoutes.rejectApplication.path(id), {
        method: apiRoutes.rejectApplication.method,
      }),

    getPushKey: (signal?: AbortSignal) => request<PushKeyResponse>(apiRoutes.getPushKey.path(), { signal }),

    subscribeToPush: (body: BodyOf<'subscribeToPush'>) =>
      request<undefined>(apiRoutes.subscribeToPush.path(), {
        method: apiRoutes.subscribeToPush.method,
        body,
      }),

    unsubscribeFromPush: (endpoint: string) =>
      request<undefined>(apiRoutes.unsubscribeFromPush.path(), {
        method: apiRoutes.unsubscribeFromPush.method,
        body: { endpoint } satisfies BodyOf<'unsubscribeFromPush'>,
      }),

    getInvites: (signal?: AbortSignal) =>
      request<AdminInvitesResponse>(apiRoutes.getInvites.path(), { signal }),

    createInvite: (body: BodyOf<'createInvite'> = {}) =>
      request<InviteResponse>(apiRoutes.createInvite.path(), { method: apiRoutes.createInvite.method, body }),

    revokeInvite: (id: string) =>
      request<undefined>(apiRoutes.revokeInvite.path(id), { method: apiRoutes.revokeInvite.method }),

    addQuestion: (body: BodyOf<'addQuestion'>) =>
      request<FormQuestionResponse>(apiRoutes.addQuestion.path(), {
        method: apiRoutes.addQuestion.method,
        body,
      }),

    updateQuestion: (id: string, body: BodyOf<'updateQuestion'>) =>
      request<FormQuestionResponse>(apiRoutes.updateQuestion.path(id), {
        method: apiRoutes.updateQuestion.method,
        body,
      }),

    deleteQuestion: (id: string) =>
      request<undefined>(apiRoutes.deleteQuestion.path(id), { method: apiRoutes.deleteQuestion.method }),

    reorderQuestions: (ids: string[]) =>
      request<FormQuestionsResponse>(apiRoutes.reorderQuestions.path(), {
        method: apiRoutes.reorderQuestions.method,
        body: orderBody(ids) satisfies FormQuestionOrder,
      }),
  }
}

export type ApiClient = ReturnType<typeof createApiClient>
