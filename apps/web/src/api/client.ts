import type { VersionResponse } from '@sage-burner/shared'

/**
 * The API client.
 *
 * Always talks to a same-origin `/api` — the backend serves both halves in
 * production, and Vite proxies to it in development — so there is no base url
 * to configure, nothing to get wrong per environment, and no CORS anywhere.
 */

/** Raised for anything that is not a 2xx. Carries enough to render a message. */
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

/** The backend's error envelope. Kept narrow deliberately — see `not_found`. */
interface ErrorBody {
  error?: unknown
}

const messageFor = (status: number, code: string) => {
  if (status === 404) return 'Not found.'
  if (status === 401) return 'You need to sign in.'
  if (status === 403) return 'You do not have access to that.'
  if (status >= 500) return 'Something went wrong at our end. Please try again.'
  return code === 'unknown' ? `Request failed (${status}).` : code
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
    const { error } = (body ?? {}) as ErrorBody
    return typeof error === 'string' ? error : 'unknown'
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
      throw apiError(response.status, code, messageFor(response.status, code))
    }

    if (response.status === 204) return undefined as T

    return (await response.json()) as T
  }

  return {
    request,
    getVersion: () => request<VersionResponse>('/version'),
  }
}

export type ApiClient = ReturnType<typeof createApiClient>
