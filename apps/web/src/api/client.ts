import type {
  AccountRolesUpdate,
  ActiveEventResponse,
  AdminAccountResponse,
  AdminAccountsResponse,
  AdminInvitesResponse,
  AdminPasswordReset,
  ApplicationCreate,
  ApplicationDecisionResponse,
  ApplicationResponse,
  ApplicationsResponse,
  Attendance,
  AttendanceUpdate,
  CopyFrom,
  CopySourcesResponse,
  EventAttendeesResponse,
  EventCreateInput,
  EventOption,
  EventOptionCreateInput,
  EventOptionKind,
  EventOptionOrder,
  EventOptionUpdate,
  EventOptionsResponse,
  EventResponse,
  EventUpdate,
  EventWelcomeUpdate,
  EventsResponse,
  FormQuestionCreateInput,
  FormQuestionOrder,
  FormQuestionResponse,
  FormQuestionUpdate,
  FormQuestionsResponse,
  InstallationResponse,
  InstallationUpdate,
  InviteCreate,
  InviteResponse,
  InviteState,
  LeadRoleCreateInput,
  LeadRoleLead,
  LeadRoleResponse,
  LeadRoleTeam,
  LeadRoleUpdate,
  LeadRolesResponse,
  LoginRequest,
  MealCreateInput,
  MealIdeaUpdate,
  MealIntroUpdate,
  MealLead,
  MealResponse,
  MealSlotCreateInput,
  MealSlotUpdate,
  MealSlotsResponse,
  MealUpdate,
  MealsResponse,
  MeResponse,
  MemberRosterResponse,
  MyBurnsResponse,
  PaymentUpdate,
  Place,
  PlaceCreate,
  PlaceOrder,
  PlaceUpdate,
  PlacesResponse,
  ProfileResponse,
  ProfileUpdate,
  PushKeyResponse,
  PushSubscriptionCreate,
  RedeemRequestInput,
  RosterResponse,
  SessionCreateInput,
  SessionResponse,
  SessionUpdate,
  SessionsResponse,
  VersionResponse,
} from '@sage-burner/shared'

/**
 * The API client.
 *
 * Always talks to a same-origin `/api` — the backend serves both halves in
 * production, and Vite proxies to it in development — so there is no base url
 * to configure, nothing to get wrong per environment, and no CORS anywhere.
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
}

/**
 * A real `Error` — so the stack survives — built by a factory rather than a
 * class, per the no-classes rule. Constructor parameter properties would also
 * be unusable here: they are not erasable syntax, and Node runs this
 * TypeScript without a compile step.
 */
export const apiError = (status: number, code: string, message: string): ApiError =>
  Object.assign(new Error(message), { name: 'ApiError', status, code })

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
  if (status >= 500) return 'Something went wrong at our end. Please try again.'
  return `Request failed (${status}).`
}

/**
 * Pull the error code out of a response without assuming the body is JSON.
 *
 * A proxy, a crash, or a misrouted request can return HTML or nothing at all,
 * and a client that assumes JSON turns those into an unrelated parse error
 * instead of the status the server actually sent.
 */
const codeFrom = async (response: Response): Promise<string> => {
  try {
    const body: unknown = await response.json()
    // Narrowed rather than cast to `ErrorResponse`: the whole point of this
    // function is that the body might not be that shape at all. Validating
    // with `errorResponseSchema` would be the obvious alternative, but that
    // would put Zod in the browser bundle — the web app imports types only.
    if (typeof body === 'object' && body !== null && 'error' in body) {
      const { error } = body
      if (typeof error === 'string') return error
    }
    return 'unknown'
  } catch {
    return 'unknown'
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

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
}

/**
 * Perform a request against the API.
 *
 * `fetch` is injectable so tests exercise the real parsing and error handling
 * against crafted responses rather than mocking this module away.
 */
export const createApiClient = (doFetch: typeof fetch = globalThis.fetch) => {
  const request = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
    const { method = 'GET', body, signal } = options

    let response: Response
    // Serialised outside the `try`: a body that will not stringify is a bug in
    // the caller, and reporting it as "could not reach the server" sends whoever
    // reads that to check their wifi.
    // A Blob goes as itself, with its own type. Everything else is JSON.
    const binary = body instanceof Blob
    const payload = body === undefined ? undefined : binary ? body : JSON.stringify(body)
    const contentType = binary ? body.type : 'application/json'

    try {
      response = await doFetch(`/api${path}`, {
        method,
        signal,
        // Sessions are cookie-based; without this the browser omits them on
        // fetch by default and every authenticated call would 401.
        credentials: 'same-origin',
        headers: payload === undefined ? undefined : { 'content-type': contentType },
        body: payload,
      })
    } catch (cause) {
      throw failureToReach(cause)
    }

    if (!response.ok) {
      const code = await codeFrom(response)
      throw apiError(response.status, code, messageFor(response.status))
    }

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
    getVersion: () => request<VersionResponse>('/version'),

    /** Public: the title is in the header of every page, signed in or not. */
    getInstallation: (signal?: AbortSignal) => request<InstallationResponse>('/installation', { signal }),

    /** Admin only. Partial — omitted fields are left as they are. */
    updateInstallation: (body: InstallationUpdate) =>
      request<InstallationResponse>('/admin/installation', { method: 'PATCH', body }),

    /** 200 with `{ viewer: null }` when signed out — not an error. */
    getMe: (signal?: AbortSignal) => request<MeResponse>('/auth/me', { signal }),

    /** Throws ApiError(401, 'invalid_credentials') on a bad email or password alike. */
    login: (body: LoginRequest) => request<MeResponse>('/auth/login', { method: 'POST', body }),

    logout: () => request<MeResponse>('/auth/logout', { method: 'POST' }),

    /**
     * Admin only. Throws ApiError(401) signed out, ApiError(403) without the
     * role — a caller may treat 401 as a cue to send the visitor to login, but
     * must not do that for 403, where signing in again changes nothing.
     */
    getAdminAccounts: (signal?: AbortSignal) => request<AdminAccountsResponse>('/admin/accounts', { signal }),

    /** Public. `{ event: null }` before the first event exists — not an error. */
    getActiveEvent: (signal?: AbortSignal) => request<ActiveEventResponse>('/events/active', { signal }),

    /**
     * Admin only. The whole set the account should end up with, not a delta.
     *
     * Throws ApiError(409, 'conflict') when it would leave no organiser at all.
     */
    setAccountRoles: (accountId: string, body: AccountRolesUpdate) =>
      request<AdminAccountResponse>(`/admin/accounts/${encodeURIComponent(accountId)}/roles`, {
        method: 'PUT',
        body,
      }),

    /**
     * Setting somebody's password for them, which nothing else can do.
     *
     * Answers 204 and echoes nothing: the caller already knows what they set, and a
     * password in a response body is a password in somebody's network log.
     */
    setAccountPassword: (accountId: string, body: AdminPasswordReset) =>
      request<undefined>(`/admin/accounts/${encodeURIComponent(accountId)}/password`, {
        method: 'PUT',
        body,
      }),

    /**
     * The burn's meals, its slot templates and the words above the table.
     *
     * Any approved member, like the lead-roles register — this replaces a tab of a
     * spreadsheet everyone could edit.
     */
    getMeals: (eventId: string, signal?: AbortSignal) =>
      request<MealsResponse>(`/events/${encodeURIComponent(eventId)}/meals`, { signal }),

    /** Moving a sitting or renaming it. Any approved member: the schedule is theirs. */
    updateMeal: (id: string, body: MealUpdate) =>
      request<MealResponse>(`/meals/${encodeURIComponent(id)}`, { method: 'PATCH', body }),

    /** Taking a meal's lead, handing it on, or vacating it with `null`. */
    setMealLead: (id: string, body: MealLead) =>
      request<MealResponse>(`/meals/${encodeURIComponent(id)}/lead`, { method: 'PUT', body }),

    /** Standing for a meal's helpers or its cleanup crew, and standing down. */
    joinMealCrew: (id: string, role: 'cleanup' | 'helper') =>
      request<MealResponse>(`/meals/${encodeURIComponent(id)}/${role}/me`, { method: 'PUT' }),

    leaveMealCrew: (id: string, role: 'cleanup' | 'helper') =>
      request<MealResponse>(`/meals/${encodeURIComponent(id)}/${role}/me`, { method: 'DELETE' }),

    /** What somebody thought of cooking. An empty one removes the note. */
    setMealIdea: (id: string, body: MealIdeaUpdate) =>
      request<MealResponse>(`/meals/${encodeURIComponent(id)}/idea`, { method: 'PUT', body }),

    /** The words above the table, which any approved member may rewrite. */
    updateMealIntro: (eventId: string, body: MealIntroUpdate) =>
      request<{ meal_intro_markdown: string }>(`/events/${encodeURIComponent(eventId)}/meal-intro`, {
        method: 'PATCH',
        body,
      }),

    /** The slot templates, and filling the burn's days in from them. Admin only. */
    getMealSlots: (eventId: string, signal?: AbortSignal) =>
      request<MealSlotsResponse>(`/admin/events/${encodeURIComponent(eventId)}/meal-slots`, { signal }),

    addMealSlot: (eventId: string, body: MealSlotCreateInput) =>
      request<MealSlotsResponse>(`/admin/events/${encodeURIComponent(eventId)}/meal-slots`, {
        method: 'POST',
        body,
      }),

    updateMealSlot: (id: string, body: MealSlotUpdate) =>
      request<MealSlotsResponse>(`/admin/meal-slots/${encodeURIComponent(id)}`, { method: 'PATCH', body }),

    deleteMealSlot: (id: string) =>
      request<undefined>(`/admin/meal-slots/${encodeURIComponent(id)}`, { method: 'DELETE' }),

    /** Adds what is missing and touches nothing else, so it is safe to press again. */
    generateMeals: (eventId: string) =>
      request<{ meals: MealsResponse['meals'] }>(
        `/admin/events/${encodeURIComponent(eventId)}/meals/generate`,
        { method: 'POST' },
      ),

    /** Adding a sitting the slots never made, and dropping one. Admin only. */
    addMeal: (eventId: string, body: MealCreateInput) =>
      request<MealResponse>(`/admin/events/${encodeURIComponent(eventId)}/meals`, { method: 'POST', body }),

    deleteMeal: (id: string) =>
      request<undefined>(`/admin/meals/${encodeURIComponent(id)}`, { method: 'DELETE' }),

    /**
     * A picture for the circle. Raw bytes, already sized down by the browser — this
     * process has no image library and wants none.
     */
    setMyAvatar: (image: Blob) => request<{ avatar: string }>('/me/avatar', { method: 'PUT', body: image }),

    removeMyAvatar: () => request<undefined>('/me/avatar', { method: 'DELETE' }),

    /** Members only. Scheduled dreams first, then the ones only offered. */
    getSessions: (eventId: string, signal?: AbortSignal) =>
      request<SessionsResponse>(`/events/${encodeURIComponent(eventId)}/sessions`, { signal }),

    /** Members only. The burn is the one named; the facilitator is whoever the body says. */
    offerSession: (eventId: string, body: SessionCreateInput) =>
      request<SessionResponse>(`/events/${encodeURIComponent(eventId)}/sessions`, {
        method: 'POST',
        body,
      }),

    /** Members only — any member may arrange the schedule, not just whoever offered it. */
    updateSession: (id: string, body: SessionUpdate) =>
      request<SessionResponse>(`/sessions/${encodeURIComponent(id)}`, { method: 'PATCH', body }),

    /** Members only. */
    withdrawSession: (id: string) =>
      request<undefined>(`/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),

    /** Offering to help run a dream, and taking the offer back. Both are idempotent. */
    helpWithSession: (id: string) =>
      request<SessionResponse>(`/sessions/${encodeURIComponent(id)}/helpers/me`, { method: 'POST' }),

    stopHelpingWithSession: (id: string) =>
      request<SessionResponse>(`/sessions/${encodeURIComponent(id)}/helpers/me`, { method: 'DELETE' }),

    /** A ❤️‍🔥, and taking it back. */
    supportSession: (id: string) =>
      request<SessionResponse>(`/sessions/${encodeURIComponent(id)}/support/me`, { method: 'POST' }),

    withdrawSupportForSession: (id: string) =>
      request<SessionResponse>(`/sessions/${encodeURIComponent(id)}/support/me`, { method: 'DELETE' }),

    /**
     * Who is coming to a burn, by name. Any approved member — names and ids only,
     * unlike `getRoster`, which carries contact details and stays admin's.
     */
    getEventAttendees: (eventId: string, signal?: AbortSignal) =>
      request<EventAttendeesResponse>(`/events/${encodeURIComponent(eventId)}/attendees`, { signal }),

    /**
     * The lead-roles register for one burn. Any approved member — for every verb
     * below too, including removing a role somebody else staffed.
     */
    getLeadRoles: (eventId: string, signal?: AbortSignal) =>
      request<LeadRolesResponse>(`/events/${encodeURIComponent(eventId)}/roles`, { signal }),

    addLeadRole: (eventId: string, body: LeadRoleCreateInput) =>
      request<LeadRoleResponse>(`/events/${encodeURIComponent(eventId)}/roles`, { method: 'POST', body }),

    /** Partial — omitted fields are left as they are. */
    updateLeadRole: (id: string, body: LeadRoleUpdate) =>
      request<LeadRoleResponse>(`/roles/${encodeURIComponent(id)}`, { method: 'PATCH', body }),

    deleteLeadRole: (id: string) =>
      request<undefined>(`/roles/${encodeURIComponent(id)}`, { method: 'DELETE' }),

    /** Taking it, handing it on, or vacating it — `account_id: null` vacates. */
    setLeadRoleLead: (id: string, accountId: string | null) =>
      request<LeadRoleResponse>(`/roles/${encodeURIComponent(id)}/lead`, {
        method: 'PUT',
        body: { account_id: accountId } satisfies LeadRoleLead,
      }),

    /** Joining twice is the same as joining once. The wanted size never refuses. */
    joinLeadRoleTeam: (id: string, accountId: string) =>
      request<LeadRoleResponse>(`/roles/${encodeURIComponent(id)}/team`, {
        method: 'POST',
        body: { account_id: accountId } satisfies LeadRoleTeam,
      }),

    leaveLeadRoleTeam: (id: string, accountId: string) =>
      request<undefined>(`/roles/${encodeURIComponent(id)}/team/${encodeURIComponent(accountId)}`, {
        method: 'DELETE',
      }),

    /** The burns this register could be seeded from, newest first. */
    getLeadRoleSources: (eventId: string, signal?: AbortSignal) =>
      request<CopySourcesResponse>(`/events/${encodeURIComponent(eventId)}/roles/sources`, { signal }),

    /** Definitions only, never people. Throws ApiError(409) if this register is not empty. */
    copyLeadRoles: (eventId: string, fromEventId: string) =>
      request<LeadRolesResponse>(`/events/${encodeURIComponent(eventId)}/roles/copy`, {
        method: 'POST',
        body: { from_event_id: fromEventId } satisfies CopyFrom,
      }),

    /**
     * One burn's lanes. Public: the ICS feed publishes locations anyway, so the list
     * is not secret. Per burn since #156 — a summer-only spot is not a lane in the
     * winter grid.
     */
    getPlaces: (eventId: string, signal?: AbortSignal) =>
      request<PlacesResponse>(`/events/${encodeURIComponent(eventId)}/places`, { signal }),

    /** Any approved member. `order` and the burn are the server's, so neither is offered. */
    addPlace: (eventId: string, body: PlaceCreate) =>
      request<{ place: Place }>(`/events/${encodeURIComponent(eventId)}/places`, { method: 'POST', body }),

    /** Any approved member. Partial — omitted fields are left as they are. */
    updatePlace: (id: string, body: PlaceUpdate) =>
      request<{ place: Place }>(`/places/${encodeURIComponent(id)}`, { method: 'PATCH', body }),

    /** Any approved member. Throws ApiError(409, 'conflict') when a dream sits in it. */
    deletePlace: (id: string) =>
      request<undefined>(`/places/${encodeURIComponent(id)}`, { method: 'DELETE' }),

    /** Any approved member. This burn's places exactly once, in the order they should appear. */
    reorderPlaces: (eventId: string, ids: readonly string[]) =>
      request<PlacesResponse>(`/events/${encodeURIComponent(eventId)}/places/order`, {
        method: 'PUT',
        body: orderBody(ids) satisfies PlaceOrder,
      }),

    /** The burns whose grid this one's could be seeded from, newest first. */
    getPlaceSources: (eventId: string, signal?: AbortSignal) =>
      request<CopySourcesResponse>(`/events/${encodeURIComponent(eventId)}/places/sources`, { signal }),

    /** The lanes, never the dreams in them. Throws ApiError(409) if this grid is not empty. */
    copyPlaces: (eventId: string, fromEventId: string) =>
      request<PlacesResponse>(`/events/${encodeURIComponent(eventId)}/places/copy`, {
        method: 'POST',
        body: { from_event_id: fromEventId } satisfies CopyFrom,
      }),

    /** Public, like the places: nothing in either list is about a person. */
    getEventOptions: (eventId: string, signal?: AbortSignal) =>
      request<EventOptionsResponse>(`/events/${encodeURIComponent(eventId)}/options`, { signal }),

    /** Any approved member. `order` is the server's to assign, per kind. */
    addEventOption: (eventId: string, body: EventOptionCreateInput) =>
      request<{ option: EventOption }>(`/events/${encodeURIComponent(eventId)}/options`, {
        method: 'POST',
        body,
      }),

    /** Any approved member. `kind` is not editable — moving one is deleting and adding. */
    updateEventOption: (id: string, body: EventOptionUpdate) =>
      request<{ option: EventOption }>(`/event-options/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body,
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
      request<undefined>(`/event-options/${encodeURIComponent(id)}`, { method: 'DELETE' }),

    /** Any approved member. Every option of that kind exactly once. */
    reorderEventOptions: (eventId: string, kind: EventOptionKind, ids: readonly string[]) =>
      request<EventOptionsResponse>(
        `/events/${encodeURIComponent(eventId)}/options/${encodeURIComponent(kind)}/order`,
        { method: 'PUT', body: orderBody(ids) satisfies EventOptionOrder },
      ),

    /** Admin only. */
    getEvents: (signal?: AbortSignal) => request<EventsResponse>('/admin/events', { signal }),

    /** Admin only. Throws ApiError(409, 'conflict') when the slug is taken. */
    createEvent: (body: EventCreateInput) =>
      request<EventResponse>('/admin/events', { method: 'POST', body }),

    /**
     * Admin only. Partial — omitted fields are left as they are.
     *
     * Carries the burn's shape, including `welcome_markdown`. A member wanting to
     * rewrite the welcome text uses `updateWelcome`; sending it here needs admin
     * like every other field.
     */
    updateEvent: (id: string, body: EventUpdate) =>
      request<EventResponse>(`/admin/events/${encodeURIComponent(id)}`, { method: 'PATCH', body }),

    /**
     * Any approved member. The welcome text and nothing else.
     *
     * Throws ApiError(400) for any other key — the route is `.strict()`, so an
     * attempt to set the cap or the dates here fails rather than being dropped.
     */
    updateWelcome: (id: string, body: EventWelcomeUpdate) =>
      request<EventResponse>(`/events/${encodeURIComponent(id)}/welcome`, { method: 'PATCH', body }),

    /** Public. The application form's questions, in display order. One central set. */
    getQuestions: (signal?: AbortSignal) => request<FormQuestionsResponse>('/questions', { signal }),

    /**
     * Public. No session — an applicant does not have one yet, which is the
     * whole point of the form.
     */
    submitApplication: (body: ApplicationCreate) =>
      request<ApplicationResponse>('/applications', { method: 'POST', body }),

    /**
     * Public. Reports whether an invite is usable without saying who it was
     * minted for — the link is forwardable, so the holder is a stranger.
     */
    getInviteState: (token: string, signal?: AbortSignal) =>
      request<InviteState>(`/invites/${encodeURIComponent(token)}`, { signal }),

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
    redeemInvite: (token: string, body: RedeemRequestInput) =>
      request<MeResponse>(`/invites/${encodeURIComponent(token)}/redeem`, { method: 'POST', body }),

    /**
     * Members only. Every burn their own page shows them, and their stay at each.
     *
     * Split into `coming` and `past` by the server, because that is a comparison
     * against a clock and a browser would answer it differently across midnight.
     */
    getMyBurns: (signal?: AbortSignal) => request<MyBurnsResponse>('/events/mine', { signal }),

    /** Members only. Idempotent — saying it twice is the same statement. */
    joinEvent: (eventId: string) =>
      request<{ attendance: Attendance }>(`/events/${encodeURIComponent(eventId)}/attendance/me`, {
        method: 'POST',
      }),

    /**
     * Members only. Answers 204. Throws ApiError(409, 'conflict') once anything
     * has been paid — what a refund means is #31's decision.
     */
    leaveEvent: (eventId: string) =>
      request<undefined>(`/events/${encodeURIComponent(eventId)}/attendance/me`, { method: 'DELETE' }),

    /** Members only. `name` and `contact` may be null on an account never filled in. */
    getMyProfile: (signal?: AbortSignal) => request<ProfileResponse>('/me/profile', { signal }),

    /** Members only. Partial — omitted fields are left as they are. */
    updateMyProfile: (body: ProfileUpdate) =>
      request<ProfileResponse>('/me/profile', { method: 'PATCH', body }),

    /**
     * Members only. Partial, and only for the burn they are coming to.
     * Throws ApiError(404) when they are not, ApiError(400) when the dates would
     * put the departure before the arrival.
     */
    updateMyStay: (eventId: string, body: AttendanceUpdate) =>
      request<{ attendance: Attendance }>(`/events/${encodeURIComponent(eventId)}/attendance/me`, {
        method: 'PATCH',
        body,
      }),

    /** Admin only. The open burn's roster; `event` is null when none is open. */
    getActiveRoster: (signal?: AbortSignal) =>
      request<RosterResponse>('/admin/events/active/roster', { signal }),

    /** The same list without payment or email, for any approved member. */
    getMembers: (eventId: string, signal?: AbortSignal) =>
      request<MemberRosterResponse>(`/events/${encodeURIComponent(eventId)}/members`, { signal }),

    /** Admin only. Payment and payment date; nothing else on the row. */
    setPayment: (eventId: string, accountId: string, body: PaymentUpdate) =>
      request<{ attendance: Attendance }>(
        `/admin/events/${encodeURIComponent(eventId)}/attendance/${encodeURIComponent(accountId)}/payment`,
        { method: 'PATCH', body },
      ),

    /** Admin only. */
    getApplications: (signal?: AbortSignal) =>
      request<ApplicationsResponse>('/admin/applications', { signal }),

    /**
     * Admin only. Returns the invite token once — it is never stored in the clear.
     * An organiser who loses it calls `reissueInvite`, which replaces the token in
     * the same row and kills the lost link doing so.
     *
     * Throws ApiError(409, 'conflict') when the application has already been
     * decided, which is what stops a double click minting two invites.
     */
    approveApplication: (id: string) =>
      request<ApplicationDecisionResponse>(`/admin/applications/${encodeURIComponent(id)}/approve`, {
        method: 'POST',
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
      request<InviteResponse>(`/admin/applications/${encodeURIComponent(id)}/invite`, {
        method: 'POST',
      }),

    /** Admin only. Throws ApiError(409, 'conflict') on an already-decided application. */
    rejectApplication: (id: string) =>
      request<ApplicationDecisionResponse>(`/admin/applications/${encodeURIComponent(id)}/reject`, {
        method: 'POST',
      }),

    /**
     * Any approved member. The key a browser needs before it can subscribe.
     *
     * `public_key` is null when push has not been set up — asking is what mints
     * the pair, so a null means the installation could not, not that it has not
     * been asked yet.
     */
    getPushKey: (signal?: AbortSignal) => request<PushKeyResponse>('/push/key', { signal }),

    /** Any approved member. Idempotent per browser: the endpoint is the key. */
    subscribeToPush: (body: PushSubscriptionCreate) =>
      request<undefined>('/push/subscriptions', { method: 'POST', body }),

    /** Any approved member. Answers 204 whether or not the endpoint was known. */
    unsubscribeFromPush: (endpoint: string) =>
      request<undefined>('/push/subscriptions', { method: 'DELETE', body: { endpoint } }),

    /** Admin only. Never carries the token — only the digest is stored. */
    getInvites: (signal?: AbortSignal) => request<AdminInvitesResponse>('/admin/invites', { signal }),

    /**
     * Admin only. Returns the token once, like approval does.
     *
     * Also the way back for an applicant who lost theirs: this mints an invite
     * with no `application_id`, so they get in but their answers stay orphaned
     * from the account. #91 is re-issuing against the application instead.
     *
     * Omit `expires_at` for the default 30 days.
     */
    createInvite: (body: InviteCreate = {}) =>
      request<InviteResponse>('/admin/invites', { method: 'POST', body }),

    /**
     * Admin only. Answers 204. Throws ApiError(409, 'conflict') for an invite
     * that has been redeemed or that belongs to an application — neither is
     * revocable.
     */
    revokeInvite: (id: string) =>
      request<undefined>(`/admin/invites/${encodeURIComponent(id)}`, { method: 'DELETE' }),

    /** Admin only. New questions go last; `order` is the server's to assign. */
    addQuestion: (body: FormQuestionCreateInput) =>
      request<FormQuestionResponse>('/admin/questions', { method: 'POST', body }),

    /** Admin only. Partial — omitted fields are left as they are. */
    updateQuestion: (id: string, body: FormQuestionUpdate) =>
      request<FormQuestionResponse>(`/admin/questions/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body,
      }),

    /** Admin only. Answers 204, so there is no body to read. */
    deleteQuestion: (id: string) =>
      request<undefined>(`/admin/questions/${encodeURIComponent(id)}`, { method: 'DELETE' }),

    /**
     * Admin only. The *complete* list of ids in the order wanted — a partial
     * list is rejected, since it would renumber some rows and leave others.
     */
    reorderQuestions: (ids: string[]) =>
      request<FormQuestionsResponse>('/admin/questions/order', {
        method: 'PUT',
        body: orderBody(ids) satisfies FormQuestionOrder,
      }),
  }
}

export type ApiClient = ReturnType<typeof createApiClient>
