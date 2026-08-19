import { describe, expect, it } from 'vitest'

import type { ProviderProfile } from './providers.ts'

import { authorizeUrl, FACEBOOK_GRAPH_VERSION, providerShapes } from './providers.ts'

const ASKED = { profileLink: true }
const NOT_ASKED = { profileLink: false }

describe('what Facebook is asked for', () => {
  it('names the profile field only where the scope was asked for', () => {
    expect(providerShapes.facebook.profile(ASKED)).toContain('link')
    expect(providerShapes.facebook.scope(ASKED)).toBe('public_profile,email,user_link')

    expect(providerShapes.facebook.profile(NOT_ASKED)).not.toContain('link')
    expect(providerShapes.facebook.scope(NOT_ASKED)).toBe('public_profile,email')
  })

  it('asks for the id and the picture either way', () => {
    for (const asks of [ASKED, NOT_ASKED]) {
      expect(providerShapes.facebook.profile(asks)).toContain(
        'fields=id,name,email,picture.width(256).height(256)',
      )
    }
  })

  it('leaves Discord with nothing to be asked, since it has no profile URL to answer', () => {
    expect(providerShapes.discord.scope()).toBe('identify email')
    expect(providerShapes.discord.profile()).toBe('https://discord.com/api/users/@me')
  })

  it('asks both for an address, since signing up is signing in now', () => {
    expect(providerShapes.discord.scope()).toContain('email')
    expect(providerShapes.facebook.scope(NOT_ASKED)).toContain('email')
    expect(providerShapes.facebook.profile(NOT_ASKED)).toContain('email')
  })

  it('takes Discord’s address only where Discord says it is verified', () => {
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
    for (const url of [
      providerShapes.facebook.authorize,
      providerShapes.facebook.token,
      providerShapes.facebook.profile({ profileLink: true }),
    ]) {
      expect(url, url).toContain(`/${FACEBOOK_GRAPH_VERSION}/`)
    }
  })

  it('is shaped like a version Meta would recognise', () => {
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

  it('keeps the display name as the name and the username as the handle, and names nobody', () => {
    const read = providerShapes.discord.read(answer({ global_name: 'ȐJaƔ' }))

    expect(read?.name).toBe('ȐJaƔ')
    expect(read?.handle).toBe('wren')
    expect(providerShapes.discord.names_the_person).toBe(false)
  })

  it('leaves the name empty where Discord has no display name, rather than using the handle for it', () => {
    expect(providerShapes.discord.read(answer())?.name).toBeUndefined()
  })
})

describe('whose name is the person’s', () => {
  it('is Facebook, whose names are mostly real, and not Discord', () => {
    expect(providerShapes.facebook.names_the_person).toBe(true)
    expect(
      providerShapes.facebook.read({ id: 'app-scoped-1', name: 'Wren', picture: { data: {} } })?.name,
    ).toBe('Wren')
  })
})
