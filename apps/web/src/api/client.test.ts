import { describe, expect, it, vi } from 'vitest'

import { createApiClient, isApiError } from './client.ts'

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
  it('sends the path the manifest built, which already carries /api', async () => {
    const doFetch = respondWith({ build_sha: 'abc123' })

    await createApiClient(doFetch).getVersion()

    expect(doFetch.mock.calls[0]?.[0]).toBe('/api/version')
  })

  it('sends cookies, since the session is cookie-based', async () => {
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

  it('hands a body the server can parse, not one wrapped in a string', async () => {
    const doFetch = respondWith({ ok: true })
    const client = createApiClient(doFetch)

    const posts: [string, () => Promise<unknown>][] = [
      ['sendDigestPreview', () => client.sendDigestPreview({ hours: 24 })],
      [
        'markTargetShown',
        () => client.markTargetShown({ link: '/meals', as_of: '2026-08-14T00:00:00.000Z' }),
      ],
      [
        'updateMyNotificationSettings',
        () => client.updateMyNotificationSettings({ on: [], email: [], digest: 'daily' }),
      ],
    ]

    for (const [name, call] of posts) {
      doFetch.mockClear()
      await call()
      const sent = doFetch.mock.calls[0]?.[1]?.body
      expect(typeof sent, name).toBe('string')
      expect(typeof JSON.parse(String(sent)), name).toBe('object')
    }
  })

  it('sends no body or content type on a plain GET', async () => {
    const doFetch = respondWith({ build_sha: 'abc' })

    await createApiClient(doFetch).getVersion()

    const init = doFetch.mock.calls[0]?.[1]
    expect(init?.body).toBeUndefined()
    expect(init?.headers).not.toHaveProperty('content-type')
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
      const doFetch = vi.fn<typeof fetch>(() =>
        Promise.resolve(new Response('<html>502 Bad Gateway</html>', { status: 502 })),
      )

      const failure = createApiClient(doFetch).request('/things')

      await expect(failure).rejects.toMatchObject({ status: 502, code: 'unknown' })
    })

    it('falls back to unknown when the code is present but not a string', async () => {
      const doFetch = respondWith({ error: { message: 'nope' } }, { status: 500 })

      await expect(createApiClient(doFetch).request('/things')).rejects.toMatchObject({
        status: 500,
        code: 'unknown',
      })
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
        { status: 429, contains: 'Wait a few seconds' },
        { status: 500, contains: 'our end' },
      ]

      for (const { status, contains } of cases) {
        const doFetch = respondWith({ error: 'nope' }, { status })
        await expect(createApiClient(doFetch).request('/things')).rejects.toThrow(contains)
      }
    })

    it('says how long to wait when the answer carries it', async () => {
      const doFetch = respondWith(
        { error: 'rate_limited' },
        { status: 429, headers: { 'retry-after': '45' } },
      )

      await expect(createApiClient(doFetch).request('/auth/login')).rejects.toThrow('in 45 seconds')
    })

    it('says one second rather than "1 seconds", which the gate really does answer', async () => {
      const doFetch = respondWith({ error: 'rate_limited' }, { status: 429, headers: { 'retry-after': '1' } })

      await expect(createApiClient(doFetch).request('/auth/login')).rejects.toThrow('in a second')
    })

    it('says it in minutes for a wait nobody counts in seconds', async () => {
      const doFetch = respondWith(
        { error: 'rate_limited' },
        { status: 429, headers: { 'retry-after': '900' } },
      )

      await expect(createApiClient(doFetch).request('/auth/login')).rejects.toThrow('in 15 minutes')
    })

    it('falls back to the vague wording for a Retry-After it cannot read', async () => {
      for (const header of ['Wed, 21 Oct 2026 07:28:00 GMT', '-1', 'soon', '1.5']) {
        const doFetch = respondWith(
          { error: 'rate_limited' },
          { status: 429, headers: { 'retry-after': header } },
        )

        await expect(createApiClient(doFetch).request('/auth/login')).rejects.toThrow('a few seconds')
      }
    })

    it('never shows a member the backend machine code for an unmapped status', async () => {
      for (const status of [400, 409, 422]) {
        const doFetch = respondWith({ error: 'validation_failed' }, { status })
        const failure = createApiClient(doFetch).request('/applications')

        await expect(failure).rejects.toThrow(`Request failed (${status}).`)
        await expect(failure).rejects.toMatchObject({ code: 'validation_failed' })
      }
    })
  })

  describe('a request that never reaches the server', () => {
    const rejectWith = (failure: unknown) => vi.fn<typeof fetch>(() => Promise.reject(failure))

    it('says the server could not be reached, not "Failed to fetch"', async () => {
      const failure = createApiClient(rejectWith(new TypeError('Failed to fetch'))).getVersion()

      await expect(failure).rejects.toThrow('Could not reach the server')
      await expect(failure).rejects.toMatchObject({ status: 0, code: 'network' })
    })

    it('is an ApiError like every other failure, so one catch handles all of them', async () => {
      const thrown = await createApiClient(rejectWith(new TypeError('Failed to fetch')))
        .getVersion()
        .catch((failure: unknown) => failure)

      expect(isApiError(thrown)).toBe(true)
    })

    it('tells a cancellation apart from a failure', async () => {
      const aborted = new DOMException('The operation was aborted.', 'AbortError')
      const failure = createApiClient(rejectWith(aborted)).getVersion()

      await expect(failure).rejects.toMatchObject({ status: 0, code: 'aborted' })
    })

    it('does not mistake an ordinary DOMException for a cancellation', async () => {
      const other = new DOMException('Something else entirely.', 'NotAllowedError')
      const failure = createApiClient(rejectWith(other)).getVersion()

      await expect(failure).rejects.toMatchObject({ code: 'network' })
    })
  })

  describe('a success with nothing in it', () => {
    const respondEmpty = (status: number, body: string | null = null) =>
      vi.fn<typeof fetch>(() => Promise.resolve(new Response(body, { status })))

    it('reads a 200 with an empty body as nothing, rather than throwing', async () => {
      await expect(createApiClient(respondEmpty(200)).request('/things')).resolves.toBeUndefined()
    })

    it('reads a whitespace-only body the same way', async () => {
      await expect(createApiClient(respondEmpty(201, '  \n')).request('/things')).resolves.toBeUndefined()
    })

    it('still parses a body that is there', async () => {
      const doFetch = vi.fn<typeof fetch>(() => Promise.resolve(new Response('{"build_sha":"abc"}')))

      await expect(createApiClient(doFetch).getVersion()).resolves.toEqual({ build_sha: 'abc' })
    })

    it('answers a broken body with the status, not a raw SyntaxError', async () => {
      const doFetch = vi.fn<typeof fetch>(() => Promise.resolve(new Response('<html>hi</html>')))
      const failure = createApiClient(doFetch).getVersion()

      await expect(failure).rejects.toMatchObject({ status: 200, code: 'unparseable' })
      await expect(failure).rejects.toThrow('Something went wrong at our end')
    })
  })

  it('maps a connection that drops mid-body, not just one that never opened', async () => {
    const dropped = new ReadableStream({
      start: (controller) => controller.error(new TypeError('network error')),
    })
    const doFetch = vi.fn<typeof fetch>(() => Promise.resolve(new Response(dropped, { status: 200 })))

    const failure = createApiClient(doFetch).getVersion()

    await expect(failure).rejects.toThrow('Could not reach the server')
    await expect(failure).rejects.toMatchObject({ status: 0, code: 'network' })
  })

  it('does not call a body it cannot serialise a network failure', async () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const doFetch = vi.fn<typeof fetch>(() => Promise.resolve(new Response('{}')))

    const thrown = await createApiClient(doFetch)
      .request('/things', { method: 'POST', body: circular })
      .catch((failure: unknown) => failure)

    expect(isApiError(thrown)).toBe(false)
    expect(doFetch).not.toHaveBeenCalled()
  })

  it('passes an abort signal through so navigation can cancel in-flight requests', async () => {
    const doFetch = respondWith({ build_sha: 'abc' })
    const controller = new AbortController()

    await createApiClient(doFetch).request('/version', { signal: controller.signal })

    expect(doFetch.mock.calls[0]?.[1]?.signal).toBe(controller.signal)
  })
})

describe('a body that is not JSON', () => {
  it('sends a Blob as itself, under its own content type', async () => {
    const doFetch = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify({ avatar: 'v1' }), { status: 200 })),
    )
    const api = createApiClient(doFetch)
    const image = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' })

    await api.setMyAvatar(image)

    const [, init] = doFetch.mock.calls[0] ?? []
    expect(init?.body).toBe(image)
    expect(init?.headers).toEqual({ 'content-type': 'image/webp' })
  })

  it('still stringifies an ordinary body, under JSON', async () => {
    const doFetch = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })),
    )
    const api = createApiClient(doFetch)

    await api.updateMealIntro('e-1', { meal_intro_markdown: 'Hello' })

    const [, init] = doFetch.mock.calls[0] ?? []
    expect(init?.body).toBe('{"meal_intro_markdown":"Hello"}')
    expect(init?.headers).toEqual({ 'content-type': 'application/json' })
  })

  it('sends no content type when there is no body at all', async () => {
    const doFetch = vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status: 204 })))
    const api = createApiClient(doFetch)

    await api.removeMyAvatar()

    const [, init] = doFetch.mock.calls[0] ?? []
    expect(init?.headers).not.toHaveProperty('content-type')
  })
})

describe('when the server answered a read (#527)', () => {
  const withDate = (date: string | undefined) =>
    vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ build_sha: 'abc' }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            ...(date === undefined ? {} : { date }),
          },
        }),
      ),
    )

  it('takes the server’s own clock off the response, as an instant', async () => {
    const client = createApiClient(withDate('Wed, 12 Aug 2026 10:00:00 GMT'))
    const { signal } = new AbortController()

    await client.getChangelog(signal)

    expect(client.readAt(signal)).toBe('2026-08-12T10:00:00.000Z')
  })

  it('keeps the oldest of the reads one load made, a page being no newer than its oldest part', async () => {
    let answered = 'Wed, 12 Aug 2026 10:01:00 GMT'
    const doFetch = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json', date: answered },
        }),
      ),
    )
    const client = createApiClient(doFetch)
    const { signal } = new AbortController()

    await client.getChangelog(signal)
    answered = 'Wed, 12 Aug 2026 10:00:00 GMT'
    await client.getChangelog(signal)

    expect(client.readAt(signal)).toBe('2026-08-12T10:00:00.000Z')
  })

  it('answers nothing for a signal no read carried, rather than a time it made up', async () => {
    const client = createApiClient(withDate('Wed, 12 Aug 2026 10:00:00 GMT'))
    const { signal } = new AbortController()

    await client.getChangelog()

    expect(client.readAt(signal)).toBeUndefined()
  })

  it('answers nothing where the response carried no date', async () => {
    const client = createApiClient(withDate(undefined))
    const { signal } = new AbortController()

    await client.getChangelog(signal)

    expect(client.readAt(signal)).toBeUndefined()
  })

  it('notes nothing for a write, which shows nobody anything', async () => {
    const client = createApiClient(withDate('Wed, 12 Aug 2026 10:00:00 GMT'))
    const { signal } = new AbortController()

    await client.request('/api/things', { method: 'POST', body: {}, signal })

    expect(client.readAt(signal)).toBeUndefined()
  })
})

describe('quoting what was read back (#274)', () => {
  const answering = (...answers: { body: unknown; init?: ResponseInit }[]) => {
    let call = 0

    return vi.fn<typeof fetch>(() => {
      const answer = answers[Math.min(call++, answers.length - 1)]

      return Promise.resolve(
        new Response(JSON.stringify(answer?.body ?? {}), {
          status: 200,
          headers: { 'content-type': 'application/json' },
          ...answer?.init,
        }),
      )
    })
  }

  const headersOf = (doFetch: ReturnType<typeof answering>, call: number) =>
    doFetch.mock.calls[call]?.[1]?.headers

  it('sends the version a guarded read handed over', async () => {
    const doFetch = answering(
      { body: { places: [] }, init: { headers: { etag: '"v1"', 'content-type': 'application/json' } } },
      { body: { place: {} } },
    )
    const api = createApiClient(doFetch)

    await api.getPlaces('e-1')
    await api.updatePlace('p-1', { name: 'Steam Room' })

    expect(headersOf(doFetch, 1)).toMatchObject({ 'if-match': '"v1"' })
  })

  it('sends none before the read that would have given it one', async () => {
    const doFetch = answering({ body: { place: {} } })

    await createApiClient(doFetch).updatePlace('p-1', { name: 'Steam Room' })

    expect(headersOf(doFetch, 0)).not.toHaveProperty('if-match')
  })

  it('keeps each guarded thing apart, so a grid is not asserted against a pool', async () => {
    const doFetch = answering(
      { body: { places: [] }, init: { headers: { etag: '"grid"', 'content-type': 'application/json' } } },
      { body: { sessions: [] }, init: { headers: { etag: '"pool"', 'content-type': 'application/json' } } },
      { body: { place: {} } },
    )
    const api = createApiClient(doFetch)

    await api.getPlaces('e-1')
    await api.getSessions('e-1')
    await api.updatePlace('p-1', { name: 'Steam Room' })

    expect(headersOf(doFetch, 2)).toMatchObject({ 'if-match': '"grid"' })
  })

  it('sends nothing on a write that is not guarded, which has nothing to overwrite', async () => {
    const doFetch = answering(
      { body: { places: [] }, init: { headers: { etag: '"v1"', 'content-type': 'application/json' } } },
      { body: { place: {} }, init: { status: 201 } },
    )
    const api = createApiClient(doFetch)

    await api.getPlaces('e-1')
    await api.addPlace('e-1', { name: 'Sauna', emoji: '🥵', color: 'red' })

    expect(headersOf(doFetch, 1)).not.toHaveProperty('if-match')
  })

  it('takes the version off a refusal, so the retry is not another read first', async () => {
    const doFetch = answering(
      { body: { places: [] }, init: { headers: { etag: '"v1"', 'content-type': 'application/json' } } },
      {
        body: { error: 'stale', places: [{ id: 'p-1', name: 'Somebody else’s name' }] },
        init: { status: 412, headers: { etag: '"v2"', 'content-type': 'application/json' } },
      },
      { body: { place: {} } },
    )
    const api = createApiClient(doFetch)

    await api.getPlaces('e-1')
    await expect(api.updatePlace('p-1', { name: 'Steam Room' })).rejects.toMatchObject({ status: 412 })
    await api.updatePlace('p-1', { name: 'Steam Room' })

    expect(headersOf(doFetch, 2)).toMatchObject({ 'if-match': '"v2"' })
  })

  it('carries what the other person wrote on the failure, not only that they did', async () => {
    const doFetch = answering({
      body: { error: 'stale', places: [{ id: 'p-1', name: 'Somebody else’s name' }] },
      init: { status: 412, headers: { etag: '"v2"', 'content-type': 'application/json' } },
    })

    const failure = createApiClient(doFetch).updatePlace('p-1', { name: 'Steam Room' })

    await expect(failure).rejects.toMatchObject({
      status: 412,
      code: 'stale',
      payload: { places: [{ name: 'Somebody else’s name' }] },
    })
  })
})
