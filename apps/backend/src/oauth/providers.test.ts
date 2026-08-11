import { describe, expect, it } from 'vitest'

import type { ProviderProfile } from './providers.ts'

import { authorizeUrl, FACEBOOK_GRAPH_VERSION, providerShapes } from './providers.ts'

/**
 * The pure half of a provider (#393, #405).
 *
 * No socket is opened here, which is the point of the module: what a provider is asked for and
 * how its answer is read are both testable without one.
 */

const ASKED = { profileLink: true }
const NOT_ASKED = { profileLink: false }

describe('what Facebook is asked for', () => {
  it('names the profile field only where the scope was asked for', () => {
    // The two have to move together. A field the token has no permission for is either omitted
    // or refused, and which one is not answerable without an unapproved app to try — so the
    // question is kept out of a sign-in entirely by never naming one unasked.
    expect(providerShapes.facebook.profile(ASKED)).toContain('link')
    expect(providerShapes.facebook.scope(ASKED)).toBe('public_profile,email,user_link')

    expect(providerShapes.facebook.profile(NOT_ASKED)).not.toContain('link')
    expect(providerShapes.facebook.scope(NOT_ASKED)).toBe('public_profile,email')
  })

  it('asks for the id and the picture either way', () => {
    // The passing sibling: the setting adds a field rather than replacing what was there, and
    // an installation that never turns it on keeps the sign-in it had.
    for (const asks of [ASKED, NOT_ASKED]) {
      expect(providerShapes.facebook.profile(asks)).toContain(
        'fields=id,email,picture.width(256).height(256)',
      )
    }
  })

  it('leaves Discord with nothing to be asked, since it has no profile URL to answer', () => {
    // Its two take no argument at all, and `satisfies ProviderShape` keeps that a compile error
    // rather than a runtime shrug — so a flag cannot quietly start meaning something here.
    expect(providerShapes.discord.scope()).toBe('identify email')
    expect(providerShapes.discord.profile()).toBe('https://discord.com/api/users/@me')
  })

  it('asks both for an address, since signing up is signing in now', () => {
    // An account is keyed by one, so an identity with no address to offer cannot make one.
    expect(providerShapes.discord.scope()).toContain('email')
    expect(providerShapes.facebook.scope(NOT_ASKED)).toContain('email')
    expect(providerShapes.facebook.profile(NOT_ASKED)).toContain('email')
  })

  it('takes Discord’s address only where Discord says it is verified', () => {
    // An unverified one is a string somebody typed into the provider, and taking it as a login
    // identity would let a stranger claim an address they do not hold.
    expect(
      providerShapes.discord.read({ id: '1', username: 'wren', email: 'wren@example.org', verified: true }),
    ).toMatchObject({ email: 'wren@example.org' })
    expect(
      providerShapes.discord.read({ id: '1', username: 'wren', email: 'wren@example.org', verified: false })
        ?.email,
    ).toBeUndefined()
    expect(providerShapes.discord.read({ id: '1', username: 'wren' })?.email).toBeUndefined()
  })

  it('takes Facebook’s address as given, which is the only signal it offers', () => {
    expect(providerShapes.facebook.read({ id: '1', email: 'wren@example.org' })).toMatchObject({
      email: 'wren@example.org',
    })
    expect(providerShapes.facebook.read({ id: '1' })?.email).toBeUndefined()
  })

  it('puts the scope it was given into the authorize URL', () => {
    const to = new URL(
      authorizeUrl('facebook', {
        clientId: 'client-1',
        redirectUri: 'https://burn.example/api/auth/oauth/facebook/callback',
        state: 'state-1',
        asks: ASKED,
      }),
    )

    expect(to.searchParams.get('scope')).toBe('public_profile,email,user_link')
  })
})

describe('the pinned Graph version', () => {
  it('is the same one on all three of Facebook’s endpoints', () => {
    // Not a restatement of the constant: the three URLs interpolate it separately, so bumping
    // one and missing another is the mistake available here — and a token exchange on a
    // different version from the authorize step is a failure at sign-in.
    for (const url of [
      providerShapes.facebook.authorize,
      providerShapes.facebook.token,
      providerShapes.facebook.profile({ profileLink: true }),
    ]) {
      expect(url, url).toContain(`/${FACEBOOK_GRAPH_VERSION}/`)
    }
  })

  it('is shaped like a version Meta would recognise', () => {
    // A typo here fails every sign-in at once and nothing else in the suite would notice, since
    // no test reaches a real endpoint.
    expect(FACEBOOK_GRAPH_VERSION).toMatch(/^v\d+\.\d+$/u)
  })
})

describe('reading what Facebook answered', () => {
  const answer = (over: Record<string, unknown> = {}) => ({
    id: 'app-scoped-1',
    picture: { data: { url: 'https://scontent.example/face.png', is_silhouette: false } },
    ...over,
  })

  it('keeps a profile URL on Facebook', () => {
    expect(providerShapes.facebook.read(answer({ link: 'https://www.facebook.com/wren' }))?.profile_url).toBe(
      'https://www.facebook.com/wren',
    )
  })

  it('keeps none where the field is absent, which is the ordinary case', () => {
    expect(providerShapes.facebook.read(answer())?.profile_url).toBeUndefined()
  })

  it('refuses a link that is not on Facebook, and still signs somebody in', () => {
    // `facebookProfileLink` is the guard, and this is the case that says a bad one costs the
    // link rather than the sign-in: the subject is what a sign-in matches on, and it survives.
    const read = providerShapes.facebook.read(answer({ link: 'https://evil.example/wren' }))

    expect(read?.profile_url).toBeUndefined()
    expect(read?.subject).toBe('app-scoped-1')
  })

  it('offers no way of being reached, since Facebook has a display name and no handle', () => {
    const read: ProviderProfile | undefined = providerShapes.facebook.read({
      id: 'app-scoped-1',
      name: 'Wren',
      picture: { data: {} },
    })

    expect(read?.reach).toBeUndefined()
  })
})

describe('reading what Discord answered', () => {
  const answer = (over: Record<string, unknown> = {}) => ({
    id: 'discord-1',
    username: 'wren',
    avatar: 'abc',
    ...over,
  })

  it('keeps the username as a way of being reached', () => {
    expect(providerShapes.discord.read(answer())?.reach).toStrictEqual({ kind: 'discord', value: 'wren' })
  })

  it('keeps none where the answer carries no username, and still signs somebody in', () => {
    const read = providerShapes.discord.read(answer({ username: undefined }))

    expect(read?.reach).toBeUndefined()
    expect(read?.subject).toBe('discord-1')
  })
})
