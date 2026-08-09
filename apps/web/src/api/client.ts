import type {
  BodyOf,
  ActiveEventResponse,
  AdminAccountResponse,
  AdminAccountsResponse,
  AdminInvitesResponse,
  ApplicationDecisionResponse,
  ApplicationResponse,
  ApplicationsResponse,
  AllergyItem,
  AllergyItemsResponse,
  Attendance,
  CopyFrom,
  CopySourcesResponse,
  EventAttendeesResponse,
  EventOption,
  EventOptionKind,
  EventOptionOrder,
  EventOptionsResponse,
  EventResponse,
  EventsResponse,
  FaqListResponse,
  FeedResponse,
  FaqResponse,
  FormQuestionOrder,
  FormQuestionResponse,
  ConnectionResponse,
  ConnectionsResponse,
  FormQuestionsResponse,
  ImageUploadResponse,
  IdentitiesResponse,
  InstallationResponse,
  OAuthSettingsResponse,
  PersonProfileResponse,
  PrivacyResponse,
  InviteResponse,
  InviteState,
  LeadRoleLead,
  LeadRoleResponse,
  LeadRoleTeam,
  LeadRolesResponse,
  MailSettingsResponse,
  MailTestResponse,
  MealResponse,
  MealSlotsResponse,
  MealsResponse,
  MeResponse,
  MemberRosterResponse,
  MyBurnsResponse,
  NotificationSettings,
  NotificationsResponse,
  PasskeysResponse,
  Place,
  PlaceOrder,
  PlacesResponse,
  Ride,
  RidesResponse,
  ProfileResponse,
  PushKeyResponse,
  RedeemResponse,
  RosterResponse,
  SessionResponse,
  SessionsResponse,
  ThreadResponse,
  ChangelogResponse,
  VersionResponse,
} from '@sage-burner/shared'
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'

import { apiRoutes } from '@sage-burner/shared'

/**
 * The API client.
 *
 * Always same-origin — the backend serves both halves in production, and Vite
 * proxies to it in development — so there is no base url to configure, nothing to
 * get wrong per environment, and no CORS anywhere.
 *
 * Every path comes from `apiRoutes`, the manifest the route files register from, so
 * the two spellings of an endpoint cannot drift (#152). That is also where the `/api`
 * prefix and the per-segment encoding live: this module used to prepend the one and
 * write out the other at 61 call sites.
 */

/**
 * Raised for anything that is not a 2xx. Carries enough to render a message.
 *
 * `code` holds the envelope's `error` slug, or the literal `'unknown'` when the
 * body was not the documented envelope — a proxy's HTML, an empty body, a
 * crash. Typed as `string` rather than the shared `ErrorCode` union on purpose:
 * the API may return a code this build predates, and narrowing would collapse
 * that to `'unknown'`, losing the one string worth putting in a bug report.
 */
export interface ApiError extends Error {
  status: number
  code: string
  /**
   * The body the failure came with, when there was one (#274).
   *
   * A stale write is refused with the resource as it now stands, so the page can
   * show what the other person wrote rather than only that somebody did. `unknown`
   * because it is a different shape per route, and the caller is the only one that
   * knows which.
   */
  payload?: unknown
}

/**
 * A real `Error` — so the stack survives — built by a factory rather than a
 * class, per the no-classes rule. Constructor parameter properties would also
 * be unusable here: they are not erasable syntax, and Node runs this
 * TypeScript without a compile step.
 */
export const apiError = (status: number, code: string, message: string, payload?: unknown): ApiError =>
  Object.assign(new Error(message), { name: 'ApiError', status, code, payload })

/**
 * The body every reorder route takes.
 *
 * One helper and a `satisfies` at each call site, so a client drifting from the
 * schema is a type error rather than a 400 at runtime. The three schemas are
 * separate — one per collection — and identical, which is why this is a shape
 * rather than a shared type.
 */
const orderBody = (ids: readonly string[]) => ({ ids: [...ids] })

export const isApiError = (value: unknown): value is ApiError =>
  value instanceof Error && 'status' in value && 'code' in value

/**
 * A message worth showing a member.
 *
 * Unmapped statuses fall back to a generic line rather than surfacing the
 * backend's machine code — a member should never read `validation_failed`.
 * The code is still on `error.code`, where a caller that knows what a
 * particular failure means can map it deliberately; a form handling 422 will
 * want to do exactly that.
 */
const messageFor = (status: number) => {
  if (status === 401) return 'You need to sign in.'
  if (status === 403) return 'You do not have access to that.'
  // Deliberately says how long. Without it the copy invites the immediate retry
  // the `Retry-After` header exists to prevent — and under a flood, that is the
  // client behaviour that makes it worse.
  if (status === 429) return 'Too many attempts just now. Wait a few seconds and try again.'
  if (status === 404) return 'Not found.'
  // The two `If-Match` refusals (#274). Both mean the same thing to whoever is
  // reading — what you were looking at has moved on — and both are recoverable by
  // trying again over what is now on screen, which the page has just reloaded.
  if (status === 412 || status === 428) {
    return 'Somebody else changed this while you had it open. It has been refreshed — have a look and try again.'
  }
  if (status >= 500) return 'Something went wrong at our end. Please try again.'
  return `Request failed (${status}).`
}

/**
 * Pull the error code and the body out of a response without assuming it is JSON.
 *
 * A proxy, a crash, or a misrouted request can return HTML or nothing at all,
 * and a client that assumes JSON turns those into an unrelated parse error
 * instead of the status the server actually sent.
 *
 * The body travels with the code because a stale write's refusal carries the
 * resource as it now stands (#274), and reading it twice is not possible — a
 * response body can only be consumed once.
 */
const failureFrom = async (response: Response): Promise<{ code: string; payload?: unknown }> => {
  try {
    const body: unknown = await response.json()
    // Narrowed rather than cast to `ErrorResponse`: the whole point of this
    // function is that the body might not be that shape at all. Validating
    // with `errorResponseSchema` would be the obvious alternative, but that
    // would put Zod in the browser bundle — the web app imports types only.
    if (typeof body === 'object' && body !== null && 'error' in body) {
      const { error } = body
      if (typeof error === 'string') return { code: error, payload: body }
    }
    return { code: 'unknown', payload: body }
  } catch {
    return { code: 'unknown' }
  }
}

/**
 * A `fetch` rejection, as an `ApiError` like every other failure.
 *
 * Offline, DNS gone, or the backend not running in dev all reject with a raw
 * `TypeError` whose message is the browser's own — `Failed to fetch` in Chrome,
 * something else again in Firefox. It is the most likely failure a member meets
 * and the one that used to skip this module's mapping entirely.
 *
 * Status 0 because there was no response to have one: nothing reached a server
 * that could answer.
 *
 * A cancellation gets its own code rather than being lumped in. A page that
 * aborts an in-flight request on navigation is tidying up, not failing, and
 * without the distinction it raises an error about its own housekeeping.
 */
const failureToReach = (cause: unknown): ApiError =>
  cause instanceof DOMException && cause.name === 'AbortError'
    ? apiError(0, 'aborted', 'Request cancelled.')
    : apiError(0, 'network', 'Could not reach the server. Check your connection and try again.')

/**
 * The shared things a version tag is kept for (#274).
 *
 * One name per representation the server guards, used at both ends: on the read it
 * says where to keep the `ETag` that came back, and on the write it says which kept
 * one to quote as `If-Match`. Naming it once at each of the two call sites is the
 * whole of the pairing — the server's half is the function the `GET` and the guard
 * share, and the route suites pin that they are the same one.
 */
export type Guarded = 'active-event' | 'faq' | 'lead-roles' | 'meals' | 'options' | 'places' | 'sessions'

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
  version?: Guarded
}

export interface ClientDeps {
  /**
   * Called for each successful read, with the response that answered it.
   *
   * How old what is on screen is can only be known where the reads happen, and the
   * service worker's stamp is on the response rather than in the body. Reads only:
   * a write that succeeds proves the server is reachable but refreshes nothing —
   * this app re-reads after every mutation, so that GET is what says so.
   */
  onRead?: (response: Response) => void
}

/**
 * Perform a request against the API.
 *
 * `fetch` is injectable so tests exercise the real parsing and error handling
 * against crafted responses rather than mocking this module away.
 */
export const createApiClient = (doFetch: typeof fetch = globalThis.fetch, { onRead }: ClientDeps = {}) => {
  /**
   * The newest version tag seen for each guarded representation.
   *
   * Per client rather than in a module, for the reason `Freshness` is: two suites in
   * one process would otherwise share one. It is deliberately keyed by what was read
   * rather than by URL — a write is given an id, not the collection's path, and the
   * app shows one burn at a time so the last read of a thing is the one on screen.
   * Quoting another burn's tag cannot succeed, only be refused, which is the safe
   * direction.
   */
  const versions = new Map<Guarded, string>()

  /** What a write asserts it was looking at. Reads have nothing to assert. */
  const precondition = (method: string, version?: Guarded): Record<string, string> => {
    const held = version === undefined ? undefined : versions.get(version)

    return method === 'GET' || held === undefined ? {} : { 'if-match': held }
  }

  /**
   * Keep the tag off a guarded answer.
   *
   * Both refusals carry one as well as the reads, so a retry after a conflict quotes
   * what the server has just said rather than needing another read first.
   */
  const noteVersion = (response: Response, version?: Guarded) => {
    if (version === undefined) return

    const tag = response.headers.get('etag')
    if (tag !== null) versions.set(version, tag)
  }

  const request = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
    const { method = 'GET', body, signal, version } = options

    let response: Response
    // Serialised outside the `try`: a body that will not stringify is a bug in
    // the caller, and reporting it as "could not reach the server" sends whoever
    // reads that to check their wifi.
    // A Blob goes as itself, with its own type. Everything else is JSON.
    const binary = body instanceof Blob
    const payload = body === undefined ? undefined : binary ? body : JSON.stringify(body)
    const contentType = binary ? body.type : 'application/json'

    try {
      // Whole, not prefixed here: the `/api` belongs to the route in `apiRoutes`,
      // which is also what lets the one endpoint outside it — the ICS feed — be
      // expressed at all.
      response = await doFetch(path, {
        method,
        signal,
        // Sessions are cookie-based; without this the browser omits them on
        // fetch by default and every authenticated call would 401.
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
      throw apiError(response.status, failure.code, messageFor(response.status), failure.payload)
    }

    if (method === 'GET') onRead?.(response)

    if (response.status === 204) return undefined as T

    // Read as text first: a 200 or 201 with no body is a success, and
    // `response.json()` would answer it with a parse error instead.
    //
    // Wrapped too, and not only the fetch above: headers can arrive and the
    // connection drop while the body is still streaming, which is the same
    // failure at a later point in the same request.
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
      // A proxy's HTML on a 200, or a truncated response. Same reasoning as
      // `codeFrom` on the error path: the request did not give us what it said
      // it would, and a raw `SyntaxError` names the wrong thing.
      throw apiError(response.status, 'unparseable', messageFor(500))
    }
  }

  return {
    request,
    getVersion: () => request<VersionResponse>(apiRoutes.getVersion.path()),

    /** Public: what changed, as the new-version notification's page shows it (#325). */
    getChangelog: (signal?: AbortSignal) =>
      request<ChangelogResponse>(apiRoutes.getChangelog.path(), { signal }),

    /** Public: the title is in the header of every page, signed in or not. */
    getInstallation: (signal?: AbortSignal) =>
      request<InstallationResponse>(apiRoutes.getInstallation.path(), { signal }),

    /** Admin only. Partial — omitted fields are left as they are. */
    updateInstallation: (body: BodyOf<'updateInstallation'>) =>
      request<InstallationResponse>(apiRoutes.updateInstallation.path(), {
        method: apiRoutes.updateInstallation.method,
        body,
      }),

    /**
     * The bell's list, newest first, with what the red bubble counts (#248).
     *
     * Signed in, any account — these are somebody's own records, and an account with
     * no role yet still has some.
     */
    getMyNotifications: (signal?: AbortSignal) =>
      request<NotificationsResponse>(apiRoutes.getMyNotifications.path(), { signal }),

    /** Answers the list back, since the bell has just changed. */
    markNotificationsSeen: () =>
      request<NotificationsResponse>(apiRoutes.markNotificationsSeen.path(), {
        method: apiRoutes.markNotificationsSeen.method,
      }),

    getMyNotificationSettings: (signal?: AbortSignal) =>
      request<NotificationSettings>(apiRoutes.getMyNotificationSettings.path(), { signal }),

    /** The whole set of muted categories, not a delta. */
    updateMyNotificationSettings: (body: BodyOf<'updateMyNotificationSettings'>) =>
      request<NotificationSettings>(apiRoutes.updateMyNotificationSettings.path(), {
        method: apiRoutes.updateMyNotificationSettings.method,
        body,
      }),

    /** 200 with `{ viewer: null }` when signed out — not an error. */
    getMe: (signal?: AbortSignal) => request<MeResponse>(apiRoutes.getMe.path(), { signal }),

    /** Throws ApiError(401, 'invalid_credentials') on a bad email or password alike. */
    login: (body: BodyOf<'login'>) =>
      request<MeResponse>(apiRoutes.login.path(), { method: apiRoutes.login.method, body }),

    logout: () => request<MeResponse>(apiRoutes.logout.path(), { method: apiRoutes.logout.method }),

    /**
     * The four halves of the two passkey ceremonies (#9).
     *
     * The option objects are the WebAuthn spec's own shapes rather than anything
     * declared in `@sage-burner/shared`: both ends already depend on
     * `@simplewebauthn` for the ceremony itself, so its types are the contract
     * here, and mirroring them would be a second spelling to keep in step. The
     * request *bodies* still come from the manifest, since those are what the
     * backend validates.
     *
     * Signed in, any account — a role is not required to manage your own way in.
     */
    startPasskeyRegistration: () =>
      request<{ options: PublicKeyCredentialCreationOptionsJSON }>(
        apiRoutes.startPasskeyRegistration.path(),
        { method: apiRoutes.startPasskeyRegistration.method },
      ),

    /** Throws ApiError(409, 'conflict') for a credential already registered. */
    addPasskey: (body: BodyOf<'addPasskey'>) =>
      request<PasskeysResponse>(apiRoutes.addPasskey.path(), {
        method: apiRoutes.addPasskey.method,
        body,
      }),

    getMyPasskeys: (signal?: AbortSignal) =>
      request<PasskeysResponse>(apiRoutes.getMyPasskeys.path(), { signal }),

    /**
     * Throws ApiError(409, 'conflict') when it would leave an account with no
     * password and no passkey — which is a lockout with nothing to undo it.
     */
    removePasskey: (id: string) =>
      request<PasskeysResponse>(apiRoutes.removePasskey.path(id), {
        method: apiRoutes.removePasskey.method,
      }),

    /** Public, and usernameless: no address is sent, so nothing here says who exists. */
    startPasskeyLogin: () =>
      request<{ options: PublicKeyCredentialRequestOptionsJSON }>(apiRoutes.startPasskeyLogin.path(), {
        method: apiRoutes.startPasskeyLogin.method,
      }),

    /** Throws ApiError(401, 'invalid_credentials') for anything that does not verify. */
    finishPasskeyLogin: (body: BodyOf<'finishPasskeyLogin'>) =>
      request<MeResponse>(apiRoutes.finishPasskeyLogin.path(), {
        method: apiRoutes.finishPasskeyLogin.method,
        body,
      }),

    /**
     * Admin only. Throws ApiError(401) signed out, ApiError(403) without the
     * role — a caller may treat 401 as a cue to send the visitor to login, but
     * must not do that for 403, where signing in again changes nothing.
     */
    getAdminAccounts: (signal?: AbortSignal) =>
      request<AdminAccountsResponse>(apiRoutes.getAdminAccounts.path(), { signal }),

    /** Public. `{ event: null }` before the first event exists — not an error. */
    getActiveEvent: (signal?: AbortSignal) =>
      request<ActiveEventResponse>(apiRoutes.getActiveEvent.path(), { signal, version: 'active-event' }),

    /**
     * Admin only. The whole set the account should end up with, not a delta.
     *
     * Throws ApiError(409, 'conflict') when it would leave no admin at all.
     */
    setAccountRoles: (accountId: string, body: BodyOf<'setAccountRoles'>) =>
      request<AdminAccountResponse>(apiRoutes.setAccountRoles.path(accountId), {
        method: apiRoutes.setAccountRoles.method,
        body,
      }),

    /**
     * Setting somebody's password for them, which nothing else can do.
     *
     * Answers 204 and echoes nothing: the caller already knows what they set, and a
     * password in a response body is a password in somebody's network log.
     */
    setAccountPassword: (accountId: string, body: BodyOf<'setAccountPassword'>) =>
      request<undefined>(apiRoutes.setAccountPassword.path(accountId), {
        method: apiRoutes.setAccountPassword.method,
        body,
      }),

    /**
     * The burn's meals, its slot templates and the words above the table.
     *
     * Any approved member, like the lead-roles register — this replaces a tab of a
     * spreadsheet everyone could edit.
     */
    getMeals: (eventId: string, signal?: AbortSignal) =>
      request<MealsResponse>(apiRoutes.getMeals.path(eventId), { signal, version: 'meals' }),

    /** Moving a sitting or renaming it. Any approved member: the schedule is theirs. */
    updateMeal: (id: string, body: BodyOf<'updateMeal'>) =>
      request<MealResponse>(apiRoutes.updateMeal.path(id), {
        method: apiRoutes.updateMeal.method,
        body,
        version: 'meals',
      }),

    /** Taking a meal's lead, handing it on, or vacating it with `null`. */
    setMealLead: (id: string, body: BodyOf<'setMealLead'>) =>
      request<MealResponse>(apiRoutes.setMealLead.path(id), { method: apiRoutes.setMealLead.method, body }),

    /**
     * Putting somebody on a meal's helpers or its cleanup crew, and taking them
     * off. Yours or anybody else's — they are told either way, unless it is them.
     */
    joinMealCrew: (id: string, role: 'cleanup' | 'helper', body: BodyOf<'joinMealCrew'>) =>
      request<MealResponse>(apiRoutes.joinMealCrew.path(id, role), {
        method: apiRoutes.joinMealCrew.method,
        body,
      }),

    leaveMealCrew: (id: string, role: 'cleanup' | 'helper', accountId: string) =>
      request<MealResponse>(apiRoutes.leaveMealCrew.path(id, role, accountId), {
        method: apiRoutes.leaveMealCrew.method,
      }),

    /** What somebody thought of cooking. An empty one removes the note. */
    setMealIdea: (id: string, body: BodyOf<'setMealIdea'>) =>
      request<MealResponse>(apiRoutes.setMealIdea.path(id), {
        method: apiRoutes.setMealIdea.method,
        body,
        version: 'meals',
      }),

    /** The words above the table, which any approved member may rewrite. */
    updateMealIntro: (eventId: string, body: BodyOf<'updateMealIntro'>) =>
      request<{ meal_intro_markdown: string }>(apiRoutes.updateMealIntro.path(eventId), {
        method: apiRoutes.updateMealIntro.method,
        body,
        version: 'meals',
      }),

    /** The slot templates, and filling the burn's days in from them. Admin only. */
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

    /** Adds what is missing and touches nothing else, so it is safe to press again. */
    generateMeals: (eventId: string) =>
      request<{ meals: MealsResponse['meals'] }>(apiRoutes.generateMeals.path(eventId), {
        method: apiRoutes.generateMeals.method,
      }),

    /** Adding a sitting the slots never made, and dropping one. Admin only. */
    addMeal: (eventId: string, body: BodyOf<'addMeal'>) =>
      request<MealResponse>(apiRoutes.addMeal.path(eventId), { method: apiRoutes.addMeal.method, body }),

    deleteMeal: (id: string) =>
      request<undefined>(apiRoutes.deleteMeal.path(id), { method: apiRoutes.deleteMeal.method }),

    /**
     * A picture for the circle. Raw bytes, already sized down by the browser — this
     * process has no image library and wants none.
     */
    setMyAvatar: (image: Blob) =>
      request<{ avatar: string }>(apiRoutes.setMyAvatar.path(), {
        method: apiRoutes.setMyAvatar.method,
        body: image,
      }),

    removeMyAvatar: () =>
      request<undefined>(apiRoutes.removeMyAvatar.path(), { method: apiRoutes.removeMyAvatar.method }),

    /** Public (#402). `privacyResponseSchema` carries why. */
    getPrivacy: (signal?: AbortSignal) => request<PrivacyResponse>(apiRoutes.getPrivacy.path(), { signal }),

    /** The ways in on this account (#393). Signed in at all is the whole guard. */
    getMyIdentities: (signal?: AbortSignal) =>
      request<IdentitiesResponse>(apiRoutes.getMyIdentities.path(), { signal }),

    removeMyIdentity: (provider: string) =>
      request<undefined>(apiRoutes.removeMyIdentity.path(provider), {
        method: apiRoutes.removeMyIdentity.method,
      }),

    /** Admin only. What a provider was set up with — never the secret. */
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

    /** Somebody, as the rest of the community sees them (#389). Approved members only. */
    getAccountProfile: (accountId: string, signal?: AbortSignal) =>
      request<PersonProfileResponse>(apiRoutes.accountProfile.path(accountId), { signal }),

    /**
     * The ways somebody can be reached, which are their own to write (#388). No
     * `If-Match`: one person's own record has one writer.
     */
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

    /**
     * A picture to write into a markdown field (#379). Raw bytes, scaled down here, and
     * the id comes back for the `![](…)` the field then holds.
     */
    uploadImage: (image: Blob) =>
      request<ImageUploadResponse>(apiRoutes.uploadImage.path(), {
        method: apiRoutes.uploadImage.method,
        body: image,
      }),

    /** Admin only. The icon an installed copy of the app wears (#256). */
    setInstallationIcon: (image: Blob) =>
      request<{ icon: string }>(apiRoutes.setInstallationIcon.path(), {
        method: apiRoutes.setInstallationIcon.method,
        body: image,
      }),

    /** Admin only. JPEG bytes the browser has already drawn to 1200 × 630. */
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

    /** Admin only. Null when nobody has set a mail server up (#30). */
    getMailSettings: (signal?: AbortSignal) =>
      request<MailSettingsResponse>(apiRoutes.getMailSettings.path(), { signal }),

    /** Admin only. An absent `password` leaves the stored one alone. */
    updateMailSettings: (body: BodyOf<'updateMailSettings'>) =>
      request<MailSettingsResponse>(apiRoutes.updateMailSettings.path(), {
        method: apiRoutes.updateMailSettings.method,
        body,
      }),

    removeMailSettings: () =>
      request<MailSettingsResponse>(apiRoutes.removeMailSettings.path(), {
        method: apiRoutes.removeMailSettings.method,
      }),

    /** Admin only. 200 whether or not it got out — the answer says which. */
    sendTestEmail: () =>
      request<MailTestResponse>(apiRoutes.sendTestEmail.path(), {
        method: apiRoutes.sendTestEmail.method,
      }),

    /**
     * Members only: what everyone has been doing, across burns (#303).
     *
     * Not per burn, unlike everything else about a burn — the quiet between them is
     * what the page is for.
     */
    getFeed: (signal?: AbortSignal) => request<FeedResponse>(apiRoutes.getFeed.path(), { signal }),

    /** Members only, per burn: the Q&A the spreadsheet had a tab for (#28). */
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

    /** Members only. Scheduled dreams first, then the ones only offered. */
    getSessions: (eventId: string, signal?: AbortSignal) =>
      request<SessionsResponse>(apiRoutes.getSessions.path(eventId), { signal, version: 'sessions' }),

    /** Members only. The burn is the one named; the facilitator is whoever the body says. */
    offerSession: (eventId: string, body: BodyOf<'offerSession'>) =>
      request<SessionResponse>(apiRoutes.offerSession.path(eventId), {
        method: apiRoutes.offerSession.method,
        body,
      }),

    /** Members only — any member may arrange the schedule, not just whoever offered it. */
    updateSession: (id: string, body: BodyOf<'updateSession'>) =>
      request<SessionResponse>(apiRoutes.updateSession.path(id), {
        method: apiRoutes.updateSession.method,
        body,
        version: 'sessions',
      }),

    /** Members only. */
    withdrawSession: (id: string) =>
      request<undefined>(apiRoutes.withdrawSession.path(id), { method: apiRoutes.withdrawSession.method }),

    /**
     * Offering a pair of hands for a dream, and taking the offer back — yours or
     * anybody else's. Both are idempotent.
     */
    helpWithSession: (id: string, body: BodyOf<'helpWithSession'>) =>
      request<SessionResponse>(apiRoutes.helpWithSession.path(id), {
        method: apiRoutes.helpWithSession.method,
        body,
      }),

    stopHelpingWithSession: (id: string, accountId: string) =>
      request<SessionResponse>(apiRoutes.stopHelpingWithSession.path(id, accountId), {
        method: apiRoutes.stopHelpingWithSession.method,
      }),

    /**
     * One conversation, whole (#375).
     *
     * By thread id, not by the dream's: a withdrawn dream keeps its thread, and the
     * card on the feed is the only place left to read it.
     */
    getThread: (id: string, signal?: AbortSignal) =>
      request<ThreadResponse>(apiRoutes.getThread.path(id), { signal }),

    postComment: (id: string, body: BodyOf<'postComment'>) =>
      request<ThreadResponse>(apiRoutes.postComment.path(id), {
        method: apiRoutes.postComment.method,
        body,
      }),

    /** The author's own. An admin may take a comment off, but never rewrite one. */
    updateComment: (id: string, body: BodyOf<'updateComment'>) =>
      request<ThreadResponse>(apiRoutes.updateComment.path(id), {
        method: apiRoutes.updateComment.method,
        body,
      }),

    deleteComment: (id: string) =>
      request<ThreadResponse>(apiRoutes.deleteComment.path(id), {
        method: apiRoutes.deleteComment.method,
      }),

    /** A ❤️‍🔥, and taking it back. */
    supportSession: (id: string) =>
      request<SessionResponse>(apiRoutes.supportSession.path(id), {
        method: apiRoutes.supportSession.method,
      }),

    withdrawSupportForSession: (id: string) =>
      request<SessionResponse>(apiRoutes.withdrawSupportForSession.path(id), {
        method: apiRoutes.withdrawSupportForSession.method,
      }),

    /**
     * Who is coming to a burn, by name. Any approved member — names and ids only,
     * unlike `getRoster`, which carries contact details and stays admin's.
     */
    getEventAttendees: (eventId: string, signal?: AbortSignal) =>
      request<EventAttendeesResponse>(apiRoutes.getEventAttendees.path(eventId), { signal }),

    /**
     * The lead-roles register for one burn. Any approved member — for every verb
     * below too, including removing a role somebody else staffed.
     */
    getLeadRoles: (eventId: string, signal?: AbortSignal) =>
      request<LeadRolesResponse>(apiRoutes.getLeadRoles.path(eventId), { signal, version: 'lead-roles' }),

    addLeadRole: (eventId: string, body: BodyOf<'addLeadRole'>) =>
      request<LeadRoleResponse>(apiRoutes.addLeadRole.path(eventId), {
        method: apiRoutes.addLeadRole.method,
        body,
      }),

    /** Partial — omitted fields are left as they are. */
    updateLeadRole: (id: string, body: BodyOf<'updateLeadRole'>) =>
      request<LeadRoleResponse>(apiRoutes.updateLeadRole.path(id), {
        method: apiRoutes.updateLeadRole.method,
        body,
        version: 'lead-roles',
      }),

    deleteLeadRole: (id: string) =>
      request<undefined>(apiRoutes.deleteLeadRole.path(id), { method: apiRoutes.deleteLeadRole.method }),

    /** Taking it, handing it on, or vacating it — `account_id: null` vacates. */
    setLeadRoleLead: (id: string, accountId: string | null) =>
      request<LeadRoleResponse>(apiRoutes.setLeadRoleLead.path(id), {
        method: apiRoutes.setLeadRoleLead.method,
        body: { account_id: accountId } satisfies LeadRoleLead,
      }),

    /** Joining twice is the same as joining once. The wanted size never refuses. */
    joinLeadRoleTeam: (id: string, accountId: string) =>
      request<LeadRoleResponse>(apiRoutes.joinLeadRoleTeam.path(id), {
        method: apiRoutes.joinLeadRoleTeam.method,
        body: { account_id: accountId } satisfies LeadRoleTeam,
      }),

    leaveLeadRoleTeam: (id: string, accountId: string) =>
      request<undefined>(apiRoutes.leaveLeadRoleTeam.path(id, accountId), {
        method: apiRoutes.leaveLeadRoleTeam.method,
      }),

    /** The burns this register could be seeded from, newest first. */
    getLeadRoleSources: (eventId: string, signal?: AbortSignal) =>
      request<CopySourcesResponse>(apiRoutes.getLeadRoleSources.path(eventId), { signal }),

    /** Definitions only, never people. Throws ApiError(409) if this register is not empty. */
    copyLeadRoles: (eventId: string, fromEventId: string) =>
      request<LeadRolesResponse>(apiRoutes.copyLeadRoles.path(eventId), {
        method: apiRoutes.copyLeadRoles.method,
        body: { from_event_id: fromEventId } satisfies CopyFrom,
      }),

    /**
     * One burn's lanes. Public: the ICS feed publishes locations anyway, so the list
     * is not secret. Per burn since #156 — a summer-only spot is not a lane in the
     * winter grid.
     */
    getPlaces: (eventId: string, signal?: AbortSignal) =>
      request<PlacesResponse>(apiRoutes.getPlaces.path(eventId), { signal, version: 'places' }),

    /** Any approved member. `order` and the burn are the server's, so neither is offered. */
    addPlace: (eventId: string, body: BodyOf<'addPlace'>) =>
      request<{ place: Place }>(apiRoutes.addPlace.path(eventId), {
        method: apiRoutes.addPlace.method,
        body,
      }),

    /** Any approved member. Partial — omitted fields are left as they are. */
    updatePlace: (id: string, body: BodyOf<'updatePlace'>) =>
      request<{ place: Place }>(apiRoutes.updatePlace.path(id), {
        method: apiRoutes.updatePlace.method,
        body,
        version: 'places',
      }),

    /** Any approved member. Throws ApiError(409, 'conflict') when a dream sits in it. */
    deletePlace: (id: string) =>
      request<undefined>(apiRoutes.deletePlace.path(id), { method: apiRoutes.deletePlace.method }),

    /** Any approved member. This burn's places exactly once, in the order they should appear. */
    reorderPlaces: (eventId: string, ids: readonly string[]) =>
      request<PlacesResponse>(apiRoutes.reorderPlaces.path(eventId), {
        method: apiRoutes.reorderPlaces.method,
        body: orderBody(ids) satisfies PlaceOrder,
        version: 'places',
      }),

    /** The burns whose grid this one's could be seeded from, newest first. */
    getPlaceSources: (eventId: string, signal?: AbortSignal) =>
      request<CopySourcesResponse>(apiRoutes.getPlaceSources.path(eventId), { signal }),

    /** The lanes, never the dreams in them. Throws ApiError(409) if this grid is not empty. */
    copyPlaces: (eventId: string, fromEventId: string) =>
      request<PlacesResponse>(apiRoutes.copyPlaces.path(eventId), {
        method: apiRoutes.copyPlaces.method,
        body: { from_event_id: fromEventId } satisfies CopyFrom,
      }),

    /**
     * Getting to the burn and back (#26). Any approved member, both halves in one list.
     *
     * No `version`: an `If-Match` guard is for the fields several people edit at once
     * (#274), and one of these has exactly one author.
     */
    getRides: (eventId: string, signal?: AbortSignal) =>
      request<RidesResponse>(apiRoutes.getRides.path(eventId), { signal }),

    /** Your own journey. The burn and the poster are the server's, so neither is offered. */
    addRide: (eventId: string, body: BodyOf<'addRide'>) =>
      request<{ ride: Ride }>(apiRoutes.addRide.path(eventId), {
        method: apiRoutes.addRide.method,
        body,
      }),

    /** Your own journey, partial — omitted fields are left as they are. */
    updateRide: (id: string, body: BodyOf<'updateRide'>) =>
      request<{ ride: Ride }>(apiRoutes.updateRide.path(id), {
        method: apiRoutes.updateRide.method,
        body,
      }),

    /** Your own journey. */
    deleteRide: (id: string) =>
      request<undefined>(apiRoutes.deleteRide.path(id), { method: apiRoutes.deleteRide.method }),

    /** Public, like the places: nothing in either list is about a person. */
    getEventOptions: (eventId: string, signal?: AbortSignal) =>
      request<EventOptionsResponse>(apiRoutes.getEventOptions.path(eventId), { signal, version: 'options' }),

    /** Any approved member. `order` is the server's to assign, per kind. */
    addEventOption: (eventId: string, body: BodyOf<'addEventOption'>) =>
      request<{ option: EventOption }>(apiRoutes.addEventOption.path(eventId), {
        method: apiRoutes.addEventOption.method,
        body,
      }),

    /** Any approved member. `kind` is not editable — moving one is deleting and adding. */
    updateEventOption: (id: string, body: BodyOf<'updateEventOption'>) =>
      request<{ option: EventOption }>(apiRoutes.updateEventOption.path(id), {
        method: apiRoutes.updateEventOption.method,
        body,
        version: 'options',
      }),

    /**
     * Any approved member. Throws ApiError(409, 'conflict') for a lodging option
     * somebody is sleeping in.
     *
     * The two kinds part company here. A **helping** option goes, and takes every
     * member's ticks with it — `attendance_helping` cascades, which is the
     * shared-spreadsheet default applied to something other people filled in. A
     * **lodging** option does not: `attendance.lodging_option_id` has no
     * `onDelete`, so the foreign key refuses and the route answers 409 rather than
     * unbooking anyone.
     */
    deleteEventOption: (id: string) =>
      request<undefined>(apiRoutes.deleteEventOption.path(id), {
        method: apiRoutes.deleteEventOption.method,
      }),

    /** Any approved member. Every option of that kind exactly once. */
    reorderEventOptions: (eventId: string, kind: EventOptionKind, ids: readonly string[]) =>
      request<EventOptionsResponse>(apiRoutes.reorderEventOptions.path(eventId, kind), {
        method: apiRoutes.reorderEventOptions.method,
        body: orderBody(ids) satisfies EventOptionOrder,
        version: 'options',
      }),

    /** Admin only. */
    getEvents: (signal?: AbortSignal) => request<EventsResponse>(apiRoutes.getEvents.path(), { signal }),

    /** Admin only. Throws ApiError(409, 'conflict') when the slug is taken. */
    createEvent: (body: BodyOf<'createEvent'>) =>
      request<EventResponse>(apiRoutes.createEvent.path(), { method: apiRoutes.createEvent.method, body }),

    /**
     * Admin only. Partial — omitted fields are left as they are.
     *
     * Carries the burn's shape, including `welcome_markdown`. A member wanting to
     * rewrite the welcome text uses `updateWelcome`; sending it here needs admin
     * like every other field.
     */
    updateEvent: (id: string, body: BodyOf<'updateEvent'>) =>
      request<EventResponse>(apiRoutes.updateEvent.path(id), { method: apiRoutes.updateEvent.method, body }),

    /**
     * Any approved member. The welcome text and nothing else.
     *
     * Throws ApiError(400) for any other key — the route is `.strict()`, so an
     * attempt to set the cap or the dates here fails rather than being dropped.
     */
    updateWelcome: (id: string, body: BodyOf<'updateWelcome'>) =>
      request<EventResponse>(apiRoutes.updateWelcome.path(id), {
        method: apiRoutes.updateWelcome.method,
        body,
        version: 'active-event',
      }),

    /** Public. The application form's questions, in display order. One central set. */
    getQuestions: (signal?: AbortSignal) =>
      request<FormQuestionsResponse>(apiRoutes.getQuestions.path(), { signal }),

    /**
     * Public. No session — an applicant does not have one yet, which is the
     * whole point of the form.
     */
    submitApplication: (body: BodyOf<'submitApplication'>) =>
      request<ApplicationResponse>(apiRoutes.submitApplication.path(), {
        method: apiRoutes.submitApplication.method,
        body,
      }),

    /**
     * Public. Reports whether an invite is usable without saying who it was
     * minted for — the link is forwardable, so the holder is a stranger.
     */
    getInviteState: (token: string, signal?: AbortSignal) =>
      request<InviteState>(apiRoutes.getInviteState.path(token), { signal }),

    /**
     * Public. Creates the account, fills in the person and signs them in.
     *
     * Throws ApiError(409) for every invite that cannot be spent — unknown,
     * expired, already used, or one that lost a race — and for an email that
     * already has an account. One answer because by this point the difference is
     * not the caller's to act on: the page has already read the status from
     * `getInviteState`, and all three mean the same thing here.
     *
     * Throws ApiError(429) when the server is already spending all the password
     * hashing it will run at once.
     */
    redeemInvite: (token: string, body: BodyOf<'redeemInvite'>) =>
      request<RedeemResponse>(apiRoutes.redeemInvite.path(token), {
        method: apiRoutes.redeemInvite.method,
        body,
      }),

    /**
     * Members only. Every burn their own page shows them, and their stay at each.
     *
     * Split into `coming` and `past` by the server, because that is a comparison
     * against a clock and a browser would answer it differently across midnight.
     */
    getMyBurns: (signal?: AbortSignal) => request<MyBurnsResponse>(apiRoutes.getMyBurns.path(), { signal }),

    /**
     * Admin only. Put somebody on a burn who did not say so when they signed up.
     *
     * Idempotent like the member's own join: adding somebody already coming answers
     * their existing stay rather than an error. Throws ApiError(404) for an account
     * or a burn that does not exist.
     */
    adminAddAttendance: (eventId: string, body: BodyOf<'adminAddAttendance'>) =>
      request<{ attendance: Attendance }>(apiRoutes.adminAddAttendance.path(eventId), {
        method: apiRoutes.adminAddAttendance.method,
        body,
      }),

    /** Members only. Idempotent — saying it twice is the same statement. */
    joinEvent: (eventId: string) =>
      request<{ attendance: Attendance }>(apiRoutes.joinEvent.path(eventId), {
        method: apiRoutes.joinEvent.method,
      }),

    /**
     * Members only. Answers 204. Throws ApiError(409, 'conflict') once anything
     * has been paid — what a refund means is #31's decision.
     */
    leaveEvent: (eventId: string) =>
      request<undefined>(apiRoutes.leaveEvent.path(eventId), { method: apiRoutes.leaveEvent.method }),

    /**
     * Hand your paid place to somebody who has not paid (#23).
     *
     * The one way out once you have paid — withdrawing is refused then, since what a
     * refund means is undecided. Leaves you off the burn entirely.
     */
    transferMyPlace: (eventId: string, body: BodyOf<'transferMyPlace'>) =>
      request<undefined>(apiRoutes.transferMyPlace.path(eventId), {
        method: apiRoutes.transferMyPlace.method,
        body,
      }),

    /**
     * The allergy vocabulary. Public, so the invite form can offer it too (#254).
     */
    getAllergyItems: (signal?: AbortSignal) =>
      request<AllergyItemsResponse>(apiRoutes.getAllergyItems.path(), { signal }),

    /** Admin. Renaming rewrites what everybody who ticked it is taken to have said. */
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

    /** 409 when somebody has ticked it — the row holds, so nobody's record is lost. */
    deleteAllergyItem: (id: string) =>
      request<undefined>(apiRoutes.deleteAllergyItem.path(id), {
        method: apiRoutes.deleteAllergyItem.method,
      }),

    reorderAllergyItems: (ids: readonly string[]) =>
      request<AllergyItemsResponse>(apiRoutes.reorderAllergyItems.path(), {
        method: apiRoutes.reorderAllergyItems.method,
        body: orderBody(ids) satisfies BodyOf<'reorderAllergyItems'>,
      }),

    /** Members only. `name` and `contact` may be null on an account never filled in. */
    getMyProfile: (signal?: AbortSignal) =>
      request<ProfileResponse>(apiRoutes.getMyProfile.path(), { signal }),

    /** Members only. Partial — omitted fields are left as they are. */
    updateMyProfile: (body: BodyOf<'updateMyProfile'>) =>
      request<ProfileResponse>(apiRoutes.updateMyProfile.path(), {
        method: apiRoutes.updateMyProfile.method,
        body,
      }),

    /**
     * Members only. Partial, and only for the burn they are coming to.
     * Throws ApiError(404) when they are not, ApiError(400) when the dates would
     * put the departure before the arrival.
     */
    updateMyStay: (eventId: string, body: BodyOf<'updateMyStay'>) =>
      request<{ attendance: Attendance }>(apiRoutes.updateMyStay.path(eventId), {
        method: apiRoutes.updateMyStay.method,
        body,
      }),

    /** Admin only. The open burn's roster; `event` is null when none is open. */
    getActiveRoster: (signal?: AbortSignal) =>
      request<RosterResponse>(apiRoutes.getActiveRoster.path(), { signal }),

    /** The same list without payment or email, for any approved member. */
    getMembers: (eventId: string, signal?: AbortSignal) =>
      request<MemberRosterResponse>(apiRoutes.getMembers.path(eventId), { signal }),

    /** Admin only. Payment and payment date; nothing else on the row. */
    setPayment: (eventId: string, accountId: string, body: BodyOf<'setPayment'>) =>
      request<{ attendance: Attendance }>(apiRoutes.setPayment.path(eventId, accountId), {
        method: apiRoutes.setPayment.method,
        body,
      }),

    /** Admin only. */
    getApplications: (signal?: AbortSignal) =>
      request<ApplicationsResponse>(apiRoutes.getApplications.path(), { signal }),

    /**
     * Admin only. Returns the invite token once — it is never stored in the clear.
     * An admin who loses it calls `reissueInvite`, which replaces the token in
     * the same row and kills the lost link doing so.
     *
     * Throws ApiError(409, 'conflict') when the application has already been
     * decided, which is what stops a double click minting two invites.
     */
    approveApplication: (id: string) =>
      request<ApplicationDecisionResponse>(apiRoutes.approveApplication.path(id), {
        method: apiRoutes.approveApplication.method,
      }),

    /**
     * Admin only. A fresh link for an approved application whose first one was lost,
     * shown once like the original. The old link stops working the moment this
     * answers.
     *
     * Throws ApiError(409, 'conflict') when the invite has already been used — they
     * are already in — or when the application is not approved.
     */
    reissueInvite: (id: string) =>
      request<InviteResponse>(apiRoutes.reissueInvite.path(id), {
        method: apiRoutes.reissueInvite.method,
      }),

    /** Admin only. Throws ApiError(409, 'conflict') on an already-decided application. */
    rejectApplication: (id: string) =>
      request<ApplicationDecisionResponse>(apiRoutes.rejectApplication.path(id), {
        method: apiRoutes.rejectApplication.method,
      }),

    /**
     * Any approved member. The key a browser needs before it can subscribe.
     *
     * `public_key` is null when push has not been set up — asking is what mints
     * the pair, so a null means the installation could not, not that it has not
     * been asked yet.
     */
    getPushKey: (signal?: AbortSignal) => request<PushKeyResponse>(apiRoutes.getPushKey.path(), { signal }),

    /** Any approved member. Idempotent per browser: the endpoint is the key. */
    subscribeToPush: (body: BodyOf<'subscribeToPush'>) =>
      request<undefined>(apiRoutes.subscribeToPush.path(), {
        method: apiRoutes.subscribeToPush.method,
        body,
      }),

    /** Any approved member. Answers 204 whether or not the endpoint was known. */
    unsubscribeFromPush: (endpoint: string) =>
      request<undefined>(apiRoutes.unsubscribeFromPush.path(), {
        method: apiRoutes.unsubscribeFromPush.method,
        body: { endpoint } satisfies BodyOf<'unsubscribeFromPush'>,
      }),

    /** Admin only. Never carries the token — only the digest is stored. */
    getInvites: (signal?: AbortSignal) =>
      request<AdminInvitesResponse>(apiRoutes.getInvites.path(), { signal }),

    /**
     * Admin only. Returns the token once, like approval does.
     *
     * Also the way back for an applicant who lost theirs: this mints an invite
     * with no `application_id`, so they get in but their answers stay orphaned
     * from the account. #91 is re-issuing against the application instead.
     *
     * Omit `expires_at` for the default 30 days.
     */
    createInvite: (body: BodyOf<'createInvite'> = {}) =>
      request<InviteResponse>(apiRoutes.createInvite.path(), { method: apiRoutes.createInvite.method, body }),

    /**
     * Admin only. Answers 204. Throws ApiError(409, 'conflict') for an invite
     * that has been redeemed or that belongs to an application — neither is
     * revocable.
     */
    revokeInvite: (id: string) =>
      request<undefined>(apiRoutes.revokeInvite.path(id), { method: apiRoutes.revokeInvite.method }),

    /** Admin only. New questions go last; `order` is the server's to assign. */
    addQuestion: (body: BodyOf<'addQuestion'>) =>
      request<FormQuestionResponse>(apiRoutes.addQuestion.path(), {
        method: apiRoutes.addQuestion.method,
        body,
      }),

    /** Admin only. Partial — omitted fields are left as they are. */
    updateQuestion: (id: string, body: BodyOf<'updateQuestion'>) =>
      request<FormQuestionResponse>(apiRoutes.updateQuestion.path(id), {
        method: apiRoutes.updateQuestion.method,
        body,
      }),

    /** Admin only. Answers 204, so there is no body to read. */
    deleteQuestion: (id: string) =>
      request<undefined>(apiRoutes.deleteQuestion.path(id), { method: apiRoutes.deleteQuestion.method }),

    /**
     * Admin only. The *complete* list of ids in the order wanted — a partial
     * list is rejected, since it would renumber some rows and leave others.
     */
    reorderQuestions: (ids: string[]) =>
      request<FormQuestionsResponse>(apiRoutes.reorderQuestions.path(), {
        method: apiRoutes.reorderQuestions.method,
        body: orderBody(ids) satisfies FormQuestionOrder,
      }),
  }
}

export type ApiClient = ReturnType<typeof createApiClient>
