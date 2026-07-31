import type {
  AdminInvitesResponse,
  Attendance,
  ApplicationCreate,
  ApplicationDecisionResponse,
  ApplicationResponse,
  ApplicationsResponse,
  Invite,
  InviteCreate,
  InviteState,
  AttendanceUpdate,
  MyAttendanceResponse,
  PaymentUpdate,
  ProfileResponse,
  ProfileUpdate,
  RedeemRequest,
  RosterResponse,
  ActiveEventResponse,
  AdminAccountsResponse,
  EventCreateInput,
  EventResponse,
  EventUpdate,
  EventsResponse,
  FormQuestionCreateInput,
  FormQuestionResponse,
  FormQuestionUpdate,
  FormQuestionsResponse,
  LoginRequest,
  MeResponse,
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

    const response = await doFetch(`/api${path}`, {
      method,
      signal,
      // Sessions are cookie-based; without this the browser omits them on
      // fetch by default and every authenticated call would 401.
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

    if (!response.ok) {
      const code = await codeFrom(response)
      throw apiError(response.status, code, messageFor(response.status))
    }

    if (response.status === 204) return undefined as T

    return (await response.json()) as T
  }

  return {
    request,
    getVersion: () => request<VersionResponse>('/version'),

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

    /** Admin only. */
    getEvents: (signal?: AbortSignal) => request<EventsResponse>('/admin/events', { signal }),

    /** Admin only. Throws ApiError(409, 'conflict') when the slug is taken. */
    createEvent: (body: EventCreateInput) =>
      request<EventResponse>('/admin/events', { method: 'POST', body }),

    /** Admin only. Partial — omitted fields are left as they are. */
    updateEvent: (id: string, body: EventUpdate) =>
      request<EventResponse>(`/admin/events/${encodeURIComponent(id)}`, { method: 'PATCH', body }),

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
     * Throws ApiError(409) for a token that is expired, already spent, or lost a
     * race, and for an email that already has an account. Throws ApiError(404)
     * for a token nobody minted.
     */
    redeemInvite: (token: string, body: RedeemRequest) =>
      request<MeResponse>(`/invites/${encodeURIComponent(token)}/redeem`, { method: 'POST', body }),

    /** Signed-in members only. `event` is null when no burn is open. */
    getMyAttendance: (signal?: AbortSignal) =>
      request<MyAttendanceResponse>('/events/active/attendance', { signal }),

    /** Members only. Idempotent — saying it twice is the same statement. */
    joinActiveEvent: () =>
      request<{ attendance: Attendance }>('/events/active/attendance', { method: 'POST' }),

    /**
     * Members only. Answers 204. Throws ApiError(409, 'conflict') once anything
     * has been paid — what a refund means is #31's decision.
     */
    leaveActiveEvent: () => request<undefined>('/events/active/attendance', { method: 'DELETE' }),

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
    updateMyStay: (body: AttendanceUpdate) =>
      request<{ attendance: Attendance }>('/events/active/attendance', { method: 'PATCH', body }),

    /** Admin only. Ordered paid-first then by joining, with `waiting` derived. */
    getRoster: (eventId: string, signal?: AbortSignal) =>
      request<RosterResponse>(`/admin/events/${encodeURIComponent(eventId)}/roster`, { signal }),

    /** Admin only. The open burn's roster; `event` is null when none is open. */
    getActiveRoster: (signal?: AbortSignal) =>
      request<RosterResponse>('/admin/events/active/roster', { signal }),

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
     * Admin only. Returns the invite token once — it is never stored in the
     * clear, and there is no re-issue path yet (#91), so a lost link is lost.
     *
     * Throws ApiError(409, 'conflict') when the application has already been
     * decided, which is what stops a double click minting two invites.
     */
    approveApplication: (id: string) =>
      request<ApplicationDecisionResponse>(`/admin/applications/${encodeURIComponent(id)}/approve`, {
        method: 'POST',
      }),

    /** Admin only. Throws ApiError(409, 'conflict') on an already-decided application. */
    rejectApplication: (id: string) =>
      request<ApplicationDecisionResponse>(`/admin/applications/${encodeURIComponent(id)}/reject`, {
        method: 'POST',
      }),

    /** Admin only. Never carries the token — only the digest is stored. */
    getInvites: (signal?: AbortSignal) => request<AdminInvitesResponse>('/admin/invites', { signal }),

    /**
     * Admin only. Returns the token once, like approval does; there is no
     * re-issue path yet (#91). Omit `expires_at` for the default 30 days.
     */
    createInvite: (body: InviteCreate = {}) =>
      request<{ invite: Invite }>('/admin/invites', { method: 'POST', body }),

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
      request<FormQuestionsResponse>('/admin/questions/order', { method: 'PUT', body: { ids } }),
  }
}

export type ApiClient = ReturnType<typeof createApiClient>
