import { describe, expect, it, vi } from 'vitest'

import { createApiClient, isApiError } from './client.ts'

// Typed as `fetch` so the recorded calls carry a RequestInit rather than an
// empty tuple, and so a signature drift in the client fails here.
const respondWith = (body: unknown, init: ResponseInit = {}) =>
  vi.fn<typeof fetch>(() =>
    Promise.resolve(
      new Response(body === undefined ? null : JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
        ...init,
      }),
    ),
  )

describe('createApiClient', () => {
  it('prefixes /api so callers never carry a base url', async () => {
    const doFetch = respondWith({ build_sha: 'abc123' })

    await createApiClient(doFetch).getVersion()

    expect(doFetch.mock.calls[0]?.[0]).toBe('/api/version')
  })

  it('sends cookies, since the session is cookie-based', async () => {
    // Without this every authenticated call 401s: fetch omits cookies by
    // default, unlike XMLHttpRequest.
    const doFetch = respondWith({ build_sha: 'abc123' })

    await createApiClient(doFetch).getVersion()

    expect(doFetch.mock.calls[0]?.[1]).toMatchObject({ credentials: 'same-origin' })
  })

  it('returns the parsed body', async () => {
    const client = createApiClient(respondWith({ build_sha: 'abc123' }))

    await expect(client.getVersion()).resolves.toEqual({ build_sha: 'abc123' })
  })

  it('sends a JSON body with a content type when given one', async () => {
    const doFetch = respondWith({ ok: true })

    await createApiClient(doFetch).request('/things', { method: 'POST', body: { name: 'a dream' } })

    expect(doFetch.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ name: 'a dream' }),
      headers: { 'content-type': 'application/json' },
    })
  })

  it('sends no body or content type on a plain GET', async () => {
    const doFetch = respondWith({ build_sha: 'abc' })

    await createApiClient(doFetch).getVersion()

    const init = doFetch.mock.calls[0]?.[1]
    expect(init?.body).toBeUndefined()
    expect(init?.headers).toBeUndefined()
  })

  it('resolves undefined for 204, which has no body to parse', async () => {
    const doFetch = respondWith(undefined, { status: 204 })

    await expect(createApiClient(doFetch).request('/things', { method: 'DELETE' })).resolves.toBeUndefined()
  })

  describe('errors', () => {
    it('raises ApiError carrying the status and the backend error code', async () => {
      const doFetch = respondWith({ error: 'not_found' }, { status: 404 })

      const failure = createApiClient(doFetch).request('/nope')

      await expect(failure).rejects.toSatisfy(isApiError)
      await expect(failure).rejects.toMatchObject({ status: 404, code: 'not_found' })
    })

    it('survives a non-JSON error body instead of turning it into a parse error', async () => {
      // A proxy, a crash, or a misrouted request can return HTML or nothing.
      // Assuming JSON would replace the real status with an unrelated
      // SyntaxError, which is the harder thing to diagnose.
      const doFetch = vi.fn<typeof fetch>(() =>
        Promise.resolve(new Response('<html>502 Bad Gateway</html>', { status: 502 })),
      )

      const failure = createApiClient(doFetch).request('/things')

      await expect(failure).rejects.toMatchObject({ status: 502, code: 'unknown' })
    })

    it('survives an entirely empty error body', async () => {
      const doFetch = vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status: 500 })))

      await expect(createApiClient(doFetch).request('/things')).rejects.toMatchObject({
        status: 500,
        code: 'unknown',
      })
    })

    it('gives a message worth showing a member rather than a status code', async () => {
      const cases = [
        { status: 401, contains: 'sign in' },
        { status: 403, contains: 'access' },
        { status: 404, contains: 'Not found' },
        { status: 500, contains: 'our end' },
      ]

      for (const { status, contains } of cases) {
        const doFetch = respondWith({ error: 'nope' }, { status })
        await expect(createApiClient(doFetch).request('/things')).rejects.toThrow(contains)
      }
    })
  })

  it('passes an abort signal through so navigation can cancel in-flight requests', async () => {
    const doFetch = respondWith({ build_sha: 'abc' })
    const controller = new AbortController()

    await createApiClient(doFetch).request('/version', { signal: controller.signal })

    expect(doFetch.mock.calls[0]?.[1]?.signal).toBe(controller.signal)
  })
})
