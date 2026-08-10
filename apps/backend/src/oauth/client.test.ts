import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchPictureOverHttps, identifyOverHttps } from './client.ts'

/**
 * The module that opens the socket (#393), which had no tests at all until #430 — and the
 * failing path is the whole reason it needed them: every misconfiguration collapsed into one
 * indistinguishable refusal, and nothing said which.
 *
 * `fetch` is stubbed rather than a server started. What is being asserted is what this module
 * sends and what it makes of what comes back, and neither wants a socket.
 */

const SECRET = 'secret-1'
const CODE = 'code-1'
const TOKEN = 'tok-1'

const input = (over: { provider?: 'facebook' | 'discord'; profileLink?: boolean } = {}) => ({
  provider: over.provider ?? ('facebook' as const),
  clientId: 'client-1',
  clientSecret: SECRET,
  redirectUri: 'https://burn.example/api/auth/oauth/facebook/callback',
  code: CODE,
  asks: { profileLink: over.profileLink ?? false },
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** A profile Facebook would answer with. */
const FACE = {
  id: 'app-scoped-1',
  picture: { data: { url: 'https://scontent.example/f.png', is_silhouette: false } },
}

/**
 * `fetch` answering the token leg and then the profile leg, in that order.
 *
 * By call order rather than by URL, because which URL is asked for is itself under test —
 * matching on it would make a wrong URL look like a missing stub.
 */
const answering = (...responses: (Response | Error)[]) => {
  // Typed arguments rather than a bare `async () =>`, so `mock.calls` carries them and the
  // assertions below need no cast to read what was sent.
  const stub = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
    const next = responses.shift()
    if (next === undefined) throw new Error('fetch was called more times than the test stubbed')
    if (next instanceof Error) throw next

    return next
  })
  vi.stubGlobal('fetch', stub)

  return stub
}

afterEach(() => vi.unstubAllGlobals())

describe('exchanging a code for somebody', () => {
  it('posts the code and spends the token on the profile', async () => {
    const stub = answering(json({ access_token: TOKEN }), json(FACE))

    const got = await identifyOverHttps(input())

    expect(got).toEqual({ profile: { subject: 'app-scoped-1', picture: 'https://scontent.example/f.png' } })

    const [tokenCall, profileCall] = stub.mock.calls
    expect(String(tokenCall?.[0])).toBe('https://graph.facebook.com/v26.0/oauth/access_token')
    expect(tokenCall?.[1]?.method).toBe('POST')

    const body = tokenCall?.[1]?.body
    // A guard rather than a cast: `BodyInit` is a union, and asserting it away would let a
    // change to a JSON body pass this while breaking every real exchange.
    expect(body).toBeInstanceOf(URLSearchParams)
    if (!(body instanceof URLSearchParams)) throw new Error('the exchange stopped being form-encoded')

    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe(CODE)
    expect(body.get('client_secret')).toBe(SECRET)
    expect(body.get('redirect_uri')).toBe(input().redirectUri)
    // The token goes as a bearer, never in the query, where it would reach a provider's logs.
    expect(profileCall?.[1]?.headers).toMatchObject({ authorization: `Bearer ${TOKEN}` })
  })

  it('asks Discord its own two endpoints', async () => {
    // The other provider through the same code, since one shape passing says nothing about the
    // other — and both were failing when this was written.
    answering(json({ access_token: TOKEN }), json({ id: 'snowflake-1', avatar: 'abc' }))

    const got = await identifyOverHttps(input({ provider: 'discord' }))

    expect(got).toEqual({
      profile: {
        subject: 'snowflake-1',
        picture: 'https://cdn.discordapp.com/avatars/snowflake-1/abc.png?size=256',
      },
    })
  })

  it('asks for the profile link only when the scope was asked for', async () => {
    const stub = answering(
      json({ access_token: TOKEN }),
      json({ ...FACE, link: 'https://facebook.com/wren' }),
    )

    const got = await identifyOverHttps(input({ profileLink: true }))

    expect(got).toEqual({
      profile: {
        subject: 'app-scoped-1',
        picture: 'https://scontent.example/f.png',
        profile_url: 'https://facebook.com/wren',
      },
    })
    expect(String(stub.mock.calls[1]?.[0])).toContain(',link')
  })
})

describe('why a round trip could not be finished', () => {
  it('names the token leg, with what the provider said', async () => {
    // A wrong secret looks like this, and the message is the whole diagnosis.
    answering(json({ error: { message: 'Error validating client secret.', code: 1 } }, 400))

    expect(await identifyOverHttps(input())).toEqual({
      failed: { at: 'token', status: 400, said: expect.stringContaining('client secret') },
    })
  })

  it('names the token leg for a 200 that carries no token', async () => {
    // An unapproved scope answers this way rather than with a 4xx, which is why the ok status
    // is not what decides — the missing `access_token` is.
    answering(json({ error: { message: 'Invalid Scopes: user_link' } }))

    expect(await identifyOverHttps(input())).toEqual({
      failed: { at: 'token', status: 200, said: expect.stringContaining('Invalid Scopes') },
    })
  })

  it('names the profile leg when the token is refused there', async () => {
    answering(json({ access_token: TOKEN }), json({ error: { message: 'Invalid OAuth access token.' } }, 401))

    expect(await identifyOverHttps(input())).toEqual({
      failed: { at: 'profile', status: 401, said: expect.stringContaining('access token') },
    })
  })

  it('names the profile leg when the answer carries no id', async () => {
    answering(json({ access_token: TOKEN }), json({ picture: { data: { url: 'https://x.example/f.png' } } }))

    expect(await identifyOverHttps(input())).toEqual({
      failed: { at: 'profile', status: 200, said: expect.stringContaining('picture') },
    })
  })

  it('keeps html and form-encoded answers verbatim rather than calling them nothing', async () => {
    // A provider having a bad day answers HTML, and Facebook answers form-encoded on some
    // errors. Neither parses, and both are the only clue there is.
    answering(new Response('<html><body>502 Bad Gateway</body></html>', { status: 502 }))

    expect(await identifyOverHttps(input())).toEqual({
      failed: { at: 'token', status: 502, said: expect.stringContaining('502 Bad Gateway') },
    })
  })

  it('names the network when nothing arrived, and says which kind', async () => {
    // The difference between a slow provider and a container with no outbound HTTPS, which is
    // the one an admin cannot otherwise tell.
    answering(Object.assign(new Error('getaddrinfo ENOTFOUND graph.facebook.com'), { name: 'TypeError' }))

    expect(await identifyOverHttps(input())).toEqual({
      failed: { at: 'network', said: expect.stringContaining('ENOTFOUND') },
    })
  })

  it('carries only which leg, the status and what came back', async () => {
    // The security property of logging any of this at all, and pinned as a whole shape rather
    // than field by field: what this module *sends* — the secret, the code, the token — must not
    // reappear in something written to a log, and neither should the decoded body. Spreading
    // `bodyOf`'s result straight in put `json` here while it was being written, so this is the
    // assertion that catches that class rather than a restatement of the interface.
    answering(json({ error: { message: 'Error validating client secret.' } }, 400))

    const got = await identifyOverHttps(input())
    if (!('failed' in got)) throw new Error('expected a failure')

    expect(Object.keys(got.failed).sort()).toEqual(['at', 'said', 'status'])
  })

  it('adds none of what it sent, even where the provider echoes it back', async () => {
    // A provider that quotes the secret back is its own problem and not one to scrub — the point
    // is that the three values appear only if they came *from* the provider, never because this
    // module put them there. Distinct from the case above, so one failing does not hide the other.
    answering(json({ error: 'plain refusal' }, 400))

    const said = JSON.stringify(await identifyOverHttps(input()))

    expect(said).not.toContain(SECRET)
    expect(said).not.toContain(CODE)
  })

  it('bounds what it keeps, so one answer cannot fill a log', async () => {
    answering(new Response('x'.repeat(5000), { status: 500 }))

    const got = await identifyOverHttps(input())
    const said = 'failed' in got ? (got.failed.said ?? '') : ''

    expect(said.length).toBeLessThanOrEqual(300)
  })
})

describe('the picture, if it is one this app will store', () => {
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )

  const bytes = (body: Buffer, type: string, status = 200) =>
    new Response(body, { status, headers: { 'content-type': type } })

  it('takes one of the three types the avatar table allows', async () => {
    answering(bytes(PNG, 'image/png'))

    expect(await fetchPictureOverHttps('https://cdn.example/f.png')).toEqual({
      bytes: PNG,
      content_type: 'image/png',
    })
  })

  it('refuses a type it could not serve back', async () => {
    answering(bytes(PNG, 'image/svg+xml'))

    expect(await fetchPictureOverHttps('https://cdn.example/f.svg')).toBeUndefined()
  })

  it('refuses anything that is not https, without asking', async () => {
    // The scheme is pinned rather than trusted, since the URL is whatever a provider named.
    const stub = answering(bytes(PNG, 'image/png'))

    expect(await fetchPictureOverHttps('http://cdn.example/f.png')).toBeUndefined()
    expect(stub).not.toHaveBeenCalled()
  })

  it('refuses more bytes than an upload would be allowed', async () => {
    answering(bytes(Buffer.alloc(3 * 1024 * 1024, 1), 'image/png'))

    expect(await fetchPictureOverHttps('https://cdn.example/big.png')).toBeUndefined()
  })
})
