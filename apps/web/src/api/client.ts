import type { LoginRequest, MeResponse, VersionResponse } from '@sage-burner/shared'

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
  }
}

export type ApiClient = ReturnType<typeof createApiClient>
