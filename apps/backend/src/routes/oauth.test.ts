import type { FastifyInstance } from 'fastify'

import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DbHandle } from '../db/index.ts'
import type { OAuthCalls } from '../oauth/client.ts'

import { createApp } from '../app.ts'
import { createSessions } from '../auth/session.ts'
import { SESSION_COOKIE } from '../auth/viewer.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import {
  account,
  accountAvatar,
  accountConnection,
  accountIdentity,
  accountRole,
  oauthSetting,
  oauthState,
  passkey,
} from '../db/schema.ts'
import { STATE_TTL_SECONDS } from './oauth.ts'

const SECRET = 's'.repeat(40)
const NOW = new Date('2026-07-02T00:00:00.000Z')

let handle: DbHandle | undefined
let app: FastifyInstance | undefined
let clock = NOW

afterEach(async () => {
  await app?.close()
  handle?.close()
  app = undefined
  handle = undefined
  clock = NOW
})

/** A tiny but real PNG, so the bytes a provider "answers" mean something. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const fakeOAuth = (over: Partial<OAuthCalls> = {}): OAuthCalls => ({
  identify: () =>
    Promise.resolve({ profile: { subject: 'provider-1', picture: 'https://cdn.example/face.png' } }),
  picture: () => Promise.resolve({ bytes: PNG, content_type: 'image/png' }),
  ...over,
})

const build = async (oauth: OAuthCalls = fakeOAuth(), logged?: string[]) => {
  handle = createDb({ url: ':memory:' })
  runMigrations(handle)
  app = await createApp({
    db: handle.db,
    config: createConfig({
      // `warn`, not `silent`, only where a test is reading the log: the refusal an admin
      // diagnoses a provider from is written at that level (#430).
      LOG_LEVEL: logged === undefined ? 'silent' : 'warn',
      SESSION_SECRET: SECRET,
      PUBLIC_ORIGIN: 'https://burn.example',
    }),
    now: () => clock,
    oauth,
    ...(logged === undefined ? {} : { logStream: { write: (chunk: string) => void logged.push(chunk) } }),
  })
  return app
}

const db = () => {
  const found = handle?.db
  if (found === undefined) throw new Error('build() first')
  return found
}

const givenAccount = async (over: { roles?: ('admin' | 'member')[]; password?: string | null } = {}) => {
  const { roles = ['member'], password = 'hashed' } = over
  const id = randomUUID()
  await db()
    .insert(account)
    .values({ id, email: `${id}@example.org`, password_hash: password, created_at: NOW.toISOString() })
  for (const role of roles) await db().insert(accountRole).values({ account_id: id, role })

  const sessions = createSessions({ secret: SECRET, now: () => new Date(), ttlSeconds: 3600 })
  return { id, cookie: `${SESSION_COOKIE}=${sessions.issue(id)}` }
}

const givenProvider = async (
  provider: 'discord' | 'facebook' = 'facebook',
  over: { ask_profile_link?: boolean } = {},
) =>
  await db()
    .insert(oauthSetting)
    .values({
      provider,
      client_id: 'client-1',
      client_secret: 'secret-1',
      ask_profile_link: over.ask_profile_link ?? false,
      updated_at: NOW.toISOString(),
    })

const start = (server: FastifyInstance, provider: string, cookie?: string) =>
  server.inject({
    method: 'GET',
    url: `/api/auth/oauth/${provider}`,
    headers: cookie === undefined ? {} : { cookie },
  })

const startLink = (server: FastifyInstance, provider: string, cookie?: string) =>
  server.inject({
    method: 'GET',
    url: `/api/me/oauth/${provider}`,
    headers: cookie === undefined ? {} : { cookie },
  })

const callback = (server: FastifyInstance, provider: string, query: string, cookie?: string) =>
  server.inject({
    method: 'GET',
    url: `/api/auth/oauth/${provider}/callback?${query}`,
    headers: cookie === undefined ? {} : { cookie },
  })

/** Every `set-cookie` on one response, as one string — the callback sets two. */
const cookiesOn = (response: { headers: Record<string, unknown> }): string =>
  [response.headers['set-cookie'] ?? []].flat().join('\n')

/** What the browser was told to keep, as it would send it back. */
const nonceFrom = (response: { headers: Record<string, unknown> }): string => {
  const header = String(response.headers['set-cookie'] ?? '')
  const value = /sage_oauth=([^;]*)/u.exec(header)?.[1]
  if (value === undefined || value === '') throw new Error('no nonce cookie was set')

  return `sage_oauth=${value}`
}

/** The state the app just minted, which is the only way a test can hold one. */
const mintedState = async () => {
  const [row] = await db().select().from(oauthState)
  if (row === undefined) throw new Error('no state was minted')
  return row.state
}

const signInThrough = async (server: FastifyInstance, provider = 'facebook') => {
  const leaving = await start(server, provider)
  return await callback(server, provider, `code=abc&state=${await mintedState()}`, nonceFrom(leaving))
}

const linkThrough = async (server: FastifyInstance, cookie: string, provider = 'facebook') => {
  const leaving = await startLink(server, provider, cookie)
  return await callback(server, provider, `code=abc&state=${await mintedState()}`, nonceFrom(leaving))
}

describe('leaving for a provider', () => {
  it('sends somebody to the provider with the state it minted', async () => {
    const server = await build()
    await givenProvider('discord')

    const leaving = await start(server, 'discord')
    const to = new URL(leaving.headers.location?.toString() ?? '')

    expect(leaving.statusCode).toBe(302)
    expect(to.origin + to.pathname).toBe('https://discord.com/oauth2/authorize')
    expect(to.searchParams.get('client_id')).toBe('client-1')
    expect(to.searchParams.get('redirect_uri')).toBe('https://burn.example/api/auth/oauth/discord/callback')
    expect(to.searchParams.get('scope')).toBe('identify')
    expect(to.searchParams.get('state')).toBe(await mintedState())
  })

  it('asks for nothing that would tell it an email address', async () => {
    // Nothing here matches on an address, so asking for one would collect what it must
    // not use — and Facebook's `email` needs review of its own.
    const server = await build()
    await givenProvider('facebook')

    const to = new URL((await start(server, 'facebook')).headers.location?.toString() ?? '')

    expect(to.searchParams.get('scope')).toBe('public_profile')
  })

  it('asks for the profile link only where the app has been approved for it', async () => {
    // The pair, and the second half is the one that matters: an app that has not been through
    // review for `user_link` must not be sent a scope naming it, because the authorize redirect
    // has already left the browser by the time this process could recover (#405).
    const server = await build()
    await givenProvider('facebook', { ask_profile_link: true })

    const asking = new URL((await start(server, 'facebook')).headers.location?.toString() ?? '')

    expect(asking.searchParams.get('scope')).toBe('public_profile,user_link')

    await db().delete(oauthSetting)
    await givenProvider('facebook', { ask_profile_link: false })

    const not = new URL((await start(server, 'facebook')).headers.location?.toString() ?? '')

    expect(not.searchParams.get('scope')).toBe('public_profile')
  })

  it('refuses a provider nobody has set up, rather than sending somebody nowhere', async () => {
    const server = await build()

    const leaving = await start(server, 'facebook')

    expect(leaving.headers.location).toBe('/login?from=refused')
    expect(await db().select().from(oauthState)).toEqual([])
  })

  it('is a 404 for something that is not a provider at all', async () => {
    const server = await build()

    expect((await start(server, 'myspace')).statusCode).toBe(404)
    expect((await callback(server, 'myspace', 'code=a&state=b')).statusCode).toBe(404)
  })

  it('sends somebody whose session has gone to the login page, not a JSON 401', async () => {
    // Reached by a plain `<a href>`, so an error envelope would land on the screen as one.
    const server = await build()
    await givenProvider()

    const refused = await startLink(server, 'facebook')

    expect(refused.statusCode).toBe(302)
    expect(refused.headers.location).toBe('/login')
  })

  it('will not leave for a provider whose secret is empty', async () => {
    // The row exists, so `oauthSettingFor` answers it — but a trip made with no secret can
    // only end at `/login?from=refused` after a full journey out and back (#401).
    const server = await build()
    await db().insert(oauthSetting).values({
      provider: 'discord',
      client_id: 'client-1',
      client_secret: '',
      updated_at: NOW.toISOString(),
    })

    const leaving = await start(server, 'discord')

    expect(leaving.headers.location).toBe('/login?from=refused')
  })

  it('starts a link for somebody with no role at all', async () => {
    // #9's rule for passkeys: an account with no role yet still has to be able to add a way
    // in and get back in with it.
    const server = await build()
    await givenProvider()
    const nobody = await givenAccount({ roles: [] })

    expect((await startLink(server, 'facebook', nobody.cookie)).statusCode).toBe(302)
  })
})

describe('signing in from a provider', () => {
  it('signs in the account that linked it', async () => {
    const server = await build()
    await givenProvider()
    const wren = await givenAccount()
    await db().insert(accountIdentity).values({
      id: randomUUID(),
      account_id: wren.id,
      provider: 'facebook',
      subject: 'provider-1',
      created_at: NOW.toISOString(),
    })

    const back = await signInThrough(server)

    expect(back.headers.location).toBe('/')
    expect(cookiesOn(back)).toContain(`${SESSION_COOKIE}=`)
  })

  it('fills in a profile URL for somebody who linked before it was asked for', async () => {
    // What makes this reach an existing member at all: their identity was written when nothing
    // asked for `user_link`, so a link only ever stored at link time would leave them having to
    // unlink and link again. A vanity name that changes lands here too.
    const server = await build(
      fakeOAuth({
        identify: () =>
          Promise.resolve({
            profile: { subject: 'provider-1', profile_url: 'https://www.facebook.com/wren' },
          }),
      }),
    )
    await givenProvider('facebook', { ask_profile_link: true })
    const wren = await givenAccount()
    await db().insert(accountIdentity).values({
      id: randomUUID(),
      account_id: wren.id,
      provider: 'facebook',
      subject: 'provider-1',
      created_at: NOW.toISOString(),
    })

    const back = await signInThrough(server)

    expect(back.headers.location).toBe('/')
    const [held] = await db().select().from(accountIdentity)
    expect(held?.profile_url).toBe('https://www.facebook.com/wren')
  })

  it('leaves the stored one alone when the provider answers none', async () => {
    // The passing sibling, and the case an installation that turns the setting back off is in:
    // nothing is asked for, so nothing overwrites what is there with null.
    const server = await build()
    await givenProvider('facebook')
    const wren = await givenAccount()
    await db().insert(accountIdentity).values({
      id: randomUUID(),
      account_id: wren.id,
      provider: 'facebook',
      subject: 'provider-1',
      profile_url: 'https://www.facebook.com/wren',
      created_at: NOW.toISOString(),
    })

    await signInThrough(server)

    const [held] = await db().select().from(accountIdentity)
    expect(held?.profile_url).toBe('https://www.facebook.com/wren')
  })

  it('creates no account for a provider nobody has linked, and says nothing either way', async () => {
    // The whole membership gate: accounts come from an invite. And `unlinked` has to be the
    // same answer whether or not an account exists for whatever address the provider holds.
    const server = await build()
    await givenProvider()

    const back = await signInThrough(server)

    expect(back.headers.location).toBe('/login?from=unlinked')
    // The nonce is cleared either way; what must not be here is a session.
    expect(cookiesOn(back)).not.toContain(`${SESSION_COOKIE}=`)
    expect(await db().select().from(account)).toEqual([])
  })

  it('spends the state, so the same callback cannot be replayed', async () => {
    const server = await build()
    await givenProvider()
    const wren = await givenAccount()
    await db().insert(accountIdentity).values({
      id: randomUUID(),
      account_id: wren.id,
      provider: 'facebook',
      subject: 'provider-1',
      created_at: NOW.toISOString(),
    })
    const leaving = await start(server, 'facebook')
    const state = await mintedState()

    const first = await callback(server, 'facebook', `code=abc&state=${state}`, nonceFrom(leaving))
    const again = await callback(server, 'facebook', `code=abc&state=${state}`, nonceFrom(leaving))

    expect(first.headers.location).toBe('/')
    expect(again.headers.location).toBe('/login?from=refused')
    expect(cookiesOn(again)).not.toContain(`${SESSION_COOKIE}=`)
  })

  it('refuses a state that has gone stale', async () => {
    const server = await build()
    await givenProvider()
    const leaving = await start(server, 'facebook')
    const state = await mintedState()

    clock = new Date(NOW.getTime() + (STATE_TTL_SECONDS + 1) * 1000)

    expect(
      (await callback(server, 'facebook', `code=abc&state=${state}`, nonceFrom(leaving))).headers.location,
    ).toBe('/login?from=refused')
  })

  it('refuses a state minted for the other provider', async () => {
    const server = await build()
    await givenProvider('discord')
    await givenProvider('facebook')
    const leaving = await start(server, 'discord')
    const state = await mintedState()

    expect(
      (await callback(server, 'facebook', `code=abc&state=${state}`, nonceFrom(leaving))).headers.location,
    ).toBe('/login?from=refused')
  })

  it('refuses a callback carrying no code, without spending anything', async () => {
    // A provider's own error redirect arrives without one; spending the state on it would
    // make somebody start again for a refusal they can see.
    const server = await build()
    await givenProvider()
    await start(server, 'facebook')

    const back = await callback(server, 'facebook', 'error=access_denied')

    expect(back.headers.location).toBe('/login?from=refused')
    expect(await db().select().from(oauthState)).toHaveLength(1)
  })

  it('refuses a callback that comes back to a different browser', async () => {
    // The one the state alone does not cover: unguessable and single-use both say nothing
    // about *who* finishes the trip. Without the nonce a member could run the flow, stop at
    // their own callback URL and hand somebody else the `?code&state` — a top-level GET,
    // which `SameSite=Lax` permits — and that browser would be issued a session for the
    // member's account. RFC 6749 §10.12.
    const server = await build()
    await givenProvider()
    const wren = await givenAccount()
    await db().insert(accountIdentity).values({
      id: randomUUID(),
      account_id: wren.id,
      provider: 'facebook',
      subject: 'provider-1',
      created_at: NOW.toISOString(),
    })
    await start(server, 'facebook')
    const state = await mintedState()

    // Everything the attacker can hand over, and nothing the browser was given.
    const back = await callback(server, 'facebook', `code=abc&state=${state}`)

    expect(back.headers.location).toBe('/login?from=refused')
    expect(cookiesOn(back)).not.toContain(`${SESSION_COOKIE}=`)
  })

  it('refuses a callback carrying somebody else’s nonce', async () => {
    const server = await build()
    await givenProvider()
    await start(server, 'facebook')
    const state = await mintedState()

    const back = await callback(server, 'facebook', `code=abc&state=${state}`, 'sage_oauth=not-the-one')

    expect(back.headers.location).toBe('/login?from=refused')
  })

  it('gives the browser a nonce it cannot read, on a path it is not sent from', async () => {
    const server = await build()
    await givenProvider()

    const leaving = await start(server, 'facebook')
    const header = cookiesOn(leaving)

    expect(header).toContain('HttpOnly')
    expect(header).toContain('SameSite=Lax')
    expect(header).toContain('Path=/api')
  })

  it('sweeps states nobody came back for', async () => {
    // An abandoned consent screen is the ordinary case, and the route that makes these is
    // unauthenticated — so nothing else would ever reclaim the row. `mintChallenge`'s
    // argument: leaving is the only thing that makes them, so it is the only thing that can
    // clear them.
    const server = await build()
    await givenProvider()
    await start(server, 'facebook')
    await start(server, 'facebook')
    expect(await db().select().from(oauthState)).toHaveLength(2)

    clock = new Date(NOW.getTime() + (STATE_TTL_SECONDS + 1) * 1000)
    await start(server, 'facebook')

    // The two stale ones are gone and only the one just minted is left.
    expect(await db().select().from(oauthState)).toHaveLength(1)
  })

  it('refuses when the provider cannot be talked to', async () => {
    const server = await build(
      fakeOAuth({ identify: () => Promise.resolve({ failed: { at: 'token' as const, status: 400 } }) }),
    )
    await givenProvider()

    expect((await signInThrough(server)).headers.location).toBe('/login?from=refused')
  })
})

describe('why a link could not be made', () => {
  it('writes the provider’s reason to the log, where an admin can read it', async () => {
    // The whole of #430. A wrong secret, a redirect URI registered differently, a scope the app
    // was never approved for and a container with no outbound HTTPS all end at the same refusal;
    // the log is the only thing that says which, and the person who configured the provider is
    // the person running the installation.
    const logged: string[] = []
    const server = await build(
      fakeOAuth({
        identify: () =>
          Promise.resolve({
            failed: { at: 'token' as const, status: 400, said: 'Error validating client secret.' },
          }),
      }),
      logged,
    )
    await givenProvider('facebook')
    const wren = await givenAccount()

    const back = await linkThrough(server, wren.cookie, 'facebook')

    // The member is told the same as before — none of this is theirs, and none of it actionable.
    expect(back.headers.location).toBe('/profile?from=refused')

    const line = logged.map((chunk) => JSON.parse(chunk) as Record<string, unknown>).at(-1)
    expect(line?.at).toBe('token')
    expect(line?.status).toBe(400)
    expect(line?.said).toBe('Error validating client secret.')
    expect(line?.provider).toBe('facebook')
    expect(line?.intent).toBe('link')
  })

  it('writes nothing about somebody who was identified', async () => {
    // The passing sibling. A warn on every round trip would bury the one that matters, and a
    // test that only asserts a line appears is satisfied by logging unconditionally.
    const logged: string[] = []
    const server = await build(fakeOAuth(), logged)
    await givenProvider('facebook')
    const wren = await givenAccount()

    await linkThrough(server, wren.cookie, 'facebook')

    expect(logged.filter((chunk) => chunk.includes('could not identify'))).toEqual([])
  })
})

describe('linking a provider to an account', () => {
  it('writes the identity and says so', async () => {
    const server = await build()
    await givenProvider()
    const wren = await givenAccount()

    const back = await linkThrough(server, wren.cookie)

    expect(back.headers.location).toBe('/profile?from=linked')
    expect(await db().select().from(accountIdentity)).toHaveLength(1)
  })

  it('attaches the identity to whoever started the trip, not whoever finished it', async () => {
    // The reason `oauth_state.account_id` exists: the account comes from the row, so a
    // callback arriving with somebody else's session cannot hand them the identity (#401).
    const server = await build()
    await givenProvider()
    const wren = await givenAccount()
    const anna = await givenAccount()

    const leaving = await startLink(server, 'facebook', wren.cookie)
    const back = await callback(
      server,
      'facebook',
      `code=abc&state=${await mintedState()}`,
      `${nonceFrom(leaving)}; ${anna.cookie}`,
    )

    expect(back.headers.location).toBe('/profile?from=linked')
    const [written] = await db().select().from(accountIdentity)
    expect(written?.account_id).toBe(wren.id)
  })

  it('refuses a provider account that is already somebody else’s', async () => {
    const server = await build()
    await givenProvider()
    const wren = await givenAccount()
    const anna = await givenAccount()
    await linkThrough(server, wren.cookie)

    const back = await linkThrough(server, anna.cookie)

    expect(back.headers.location).toBe('/profile?from=taken')
    expect(await db().select().from(accountIdentity)).toHaveLength(1)
  })

  it('takes their picture when the account has none', async () => {
    const server = await build()
    await givenProvider()
    const wren = await givenAccount()

    await linkThrough(server, wren.cookie)

    const [held] = await db().select().from(accountAvatar).where(eq(accountAvatar.account_id, wren.id))
    expect(held?.content_type).toBe('image/png')
    expect(held?.image.equals(PNG)).toBe(true)
  })

  it('does not even ask for a picture when they have one', async () => {
    // A provider's is a better start than initials and never better than one somebody
    // picked. Asserted on the *fetch* rather than on the stored bytes: the avatar table's
    // primary key would refuse the second write anyway, so a test that only checked the
    // bytes passes with the guard deleted — which is what it was doing before this comment.
    const asked = vi.fn(() => Promise.resolve({ bytes: PNG, content_type: 'image/png' as const }))
    const server = await build(fakeOAuth({ picture: asked }))
    await givenProvider()
    const wren = await givenAccount()
    const mine = Buffer.concat([PNG, Buffer.from([0])])
    await db().insert(accountAvatar).values({
      account_id: wren.id,
      image: mine,
      content_type: 'image/webp',
      updated_at: NOW.toISOString(),
    })

    await linkThrough(server, wren.cookie)

    expect(asked).not.toHaveBeenCalled()
    const [held] = await db().select().from(accountAvatar).where(eq(accountAvatar.account_id, wren.id))
    expect(held?.image.equals(mine)).toBe(true)
  })

  it('takes no picture where the provider offers none', async () => {
    // Facebook's silhouette and Discord's default are both "not them", and replacing
    // initials with a grey shape says less rather than more.
    const server = await build(
      fakeOAuth({ identify: () => Promise.resolve({ profile: { subject: 'provider-1' } }) }),
    )
    await givenProvider()
    const wren = await givenAccount()

    await linkThrough(server, wren.cookie)

    expect(await db().select().from(accountAvatar)).toEqual([])
  })

  it('does not cost somebody the link when the picture cannot be fetched', async () => {
    const server = await build(
      fakeOAuth({ picture: () => Promise.reject(new Error('the CDN is having a day')) }),
    )
    await givenProvider()
    const wren = await givenAccount()

    const back = await linkThrough(server, wren.cookie)

    expect(back.headers.location).toBe('/profile?from=linked')
    expect(await db().select().from(accountIdentity)).toHaveLength(1)
  })

  it('writes no way of being reached from the id a provider hands over', async () => {
    // It used to write a `messenger` row from `profile.subject`. Facebook answers
    // `public_profile` with an **app-scoped** id, which identifies nobody outside this
    // installation's Meta app — so `m.me/<that>` pointed at nobody. A Messenger row still only
    // ever comes from a handle somebody typed; the profile link may come from `user_link`
    // (#405), and that is a URL Facebook answered rather than an id.
    const server = await build()
    await givenProvider('facebook')
    const wren = await givenAccount()

    await linkThrough(server, wren.cookie, 'facebook')

    expect(await db().select().from(accountConnection)).toEqual([])
  })

  it('keeps the profile URL the provider answered', async () => {
    const server = await build(
      fakeOAuth({
        identify: () =>
          Promise.resolve({
            profile: { subject: 'provider-1', profile_url: 'https://www.facebook.com/wren' },
          }),
      }),
    )
    await givenProvider('facebook', { ask_profile_link: true })
    const wren = await givenAccount()

    await linkThrough(server, wren.cookie, 'facebook')

    const [written] = await db().select().from(accountIdentity)
    expect(written?.profile_url).toBe('https://www.facebook.com/wren')
  })

  it('keeps none where the provider was never asked for one', async () => {
    // The ordinary case, and the one that has to keep working: an installation whose admin never
    // went to app review for `user_link` gets exactly the link it had before.
    const server = await build()
    await givenProvider('facebook')
    const wren = await givenAccount()

    await linkThrough(server, wren.cookie, 'facebook')

    const [written] = await db().select().from(accountIdentity)
    expect(written?.profile_url).toBeNull()
  })
})

describe('the ways in on an account', () => {
  const identities = (server: FastifyInstance, cookie?: string) =>
    server.inject({
      method: 'GET',
      url: '/api/me/identities',
      headers: cookie === undefined ? {} : { cookie },
    })

  const forget = (server: FastifyInstance, provider: string, cookie?: string) =>
    server.inject({
      method: 'DELETE',
      url: `/api/me/identities/${provider}`,
      headers: cookie === undefined ? {} : { cookie },
    })

  it('lists what has been linked, and not the provider’s id for somebody', async () => {
    const server = await build()
    await givenProvider()
    const wren = await givenAccount()
    await linkThrough(server, wren.cookie)

    const listed = await identities(server, wren.cookie)

    expect(listed.json().identities).toEqual([{ provider: 'facebook', created_at: NOW.toISOString() }])
    expect(listed.payload).not.toContain('provider-1')
  })

  it('is nobody’s to read without a session', async () => {
    const server = await build()

    expect((await identities(server)).statusCode).toBe(401)
  })

  it('takes one off when a password is left', async () => {
    const server = await build()
    await givenProvider()
    const wren = await givenAccount({ password: 'hashed' })
    await linkThrough(server, wren.cookie)

    expect((await forget(server, 'facebook', wren.cookie)).statusCode).toBe(204)
    expect(await db().select().from(accountIdentity)).toEqual([])
  })

  it('refuses to take away the only way in', async () => {
    // `removePasskey`'s 409, generalised. Somebody who set no password and linked one
    // provider has exactly one, and losing it locks them out of a burn they have paid for.
    const server = await build()
    await givenProvider()
    const wren = await givenAccount({ password: null })
    await linkThrough(server, wren.cookie)

    expect((await forget(server, 'facebook', wren.cookie)).statusCode).toBe(409)
    expect(await db().select().from(accountIdentity)).toHaveLength(1)
  })

  it('counts a passkey as another way in', async () => {
    const server = await build()
    await givenProvider()
    const wren = await givenAccount({ password: null })
    await linkThrough(server, wren.cookie)
    await db().insert(passkey).values({
      id: randomUUID(),
      account_id: wren.id,
      credential_id: 'cred-1',
      public_key: 'a-cose-key',
      counter: 0,
      transports: null,
      label: 'Phone',
      created_at: NOW.toISOString(),
      last_used_at: null,
    })

    expect((await forget(server, 'facebook', wren.cookie)).statusCode).toBe(204)
  })

  it('counts the other provider as another way in, which nothing else asserted', async () => {
    // The third `exists` in `anotherWayInSurvives`, and the passing sibling the refusal
    // tests do not give: a break that is too *permissive* is caught by "refuses to take
    // away the only way in", but a too-restrictive one would silently stop an account with
    // two providers and no password from unlinking either, and nothing would fail.
    const server = await build()
    await givenProvider('discord')
    await givenProvider('facebook')
    const wren = await givenAccount({ password: null })
    await linkThrough(server, wren.cookie, 'discord')
    await linkThrough(server, wren.cookie, 'facebook')

    expect((await forget(server, 'facebook', wren.cookie)).statusCode).toBe(204)
    // And now it is the only one left, so it cannot go — the same guard, from the other side.
    expect((await forget(server, 'discord', wren.cookie)).statusCode).toBe(409)
  })

  it('answers 404 for a provider that was never linked', async () => {
    const server = await build()
    const wren = await givenAccount()

    expect((await forget(server, 'facebook', wren.cookie)).statusCode).toBe(404)
  })
})

describe('setting a provider up', () => {
  const read = (server: FastifyInstance, provider: string, cookie: string) =>
    server.inject({
      method: 'GET',
      url: `/api/admin/installation/oauth/${provider}`,
      headers: { cookie },
    })

  const save = (
    server: FastifyInstance,
    provider: string,
    cookie: string,
    // Concrete rather than `unknown`: `inject` resolves to its chainable type for a payload
    // it cannot see the shape of, and then `await` gives back something with no `statusCode`.
    payload: { client_id: string; client_secret?: string },
  ) =>
    server.inject({
      method: 'PUT',
      url: `/api/admin/installation/oauth/${provider}`,
      headers: { cookie },
      payload,
    })

  it('answers null before anybody has, which is the ordinary state', async () => {
    const server = await build()
    const boss = await givenAccount({ roles: ['admin'] })

    expect((await read(server, 'facebook', boss.cookie)).json().settings).toBeNull()
  })

  it('never sends the secret back', async () => {
    const server = await build()
    const boss = await givenAccount({ roles: ['admin'] })

    const saved = await save(server, 'facebook', boss.cookie, {
      client_id: 'client-1',
      client_secret: 'hunter2',
    })

    expect(saved.json().settings).toMatchObject({ client_id: 'client-1', has_secret: true })
    expect(saved.payload).not.toContain('hunter2')
    expect((await read(server, 'facebook', boss.cookie)).payload).not.toContain('hunter2')
  })

  it('keeps the stored secret when a save omits it', async () => {
    // Otherwise correcting a typo in the id means typing the secret again, and a form that
    // has to hold it keeps it in an input on every visit.
    const server = await build()
    const boss = await givenAccount({ roles: ['admin'] })
    await save(server, 'facebook', boss.cookie, { client_id: 'client-1', client_secret: 'hunter2' })

    await save(server, 'facebook', boss.cookie, { client_id: 'client-2' })

    const [row] = await db().select().from(oauthSetting)
    expect(row).toMatchObject({ client_id: 'client-2', client_secret: 'hunter2' })
  })

  it('clears it for an empty one, which is the other half of that', async () => {
    const server = await build()
    const boss = await givenAccount({ roles: ['admin'] })
    await save(server, 'facebook', boss.cookie, { client_id: 'client-1', client_secret: 'hunter2' })

    await save(server, 'facebook', boss.cookie, { client_id: 'client-1', client_secret: '' })

    expect((await read(server, 'facebook', boss.cookie)).json().settings.has_secret).toBe(false)
  })

  it('takes the button off the login page when a provider is removed', async () => {
    const server = await build()
    const boss = await givenAccount({ roles: ['admin'] })
    await save(server, 'facebook', boss.cookie, { client_id: 'client-1', client_secret: 'hunter2' })

    const removed = await server.inject({
      method: 'DELETE',
      url: '/api/admin/installation/oauth/facebook',
      headers: { cookie: boss.cookie },
    })

    expect(removed.json().settings).toBeNull()
    const installation = await server.inject({ method: 'GET', url: '/api/installation' })
    expect(installation.json().installation.social_logins).toEqual([])
  })

  it('tells the public which providers are configured, and nothing else about them', async () => {
    const server = await build()
    const boss = await givenAccount({ roles: ['admin'] })
    await save(server, 'discord', boss.cookie, { client_id: 'client-1', client_secret: 'hunter2' })

    const installation = await server.inject({ method: 'GET', url: '/api/installation' })

    expect(installation.json().installation.social_logins).toEqual(['discord'])
    expect(installation.payload).not.toContain('client-1')
  })

  it('draws no button for a client id saved with no secret', async () => {
    // A row exists, so selecting on existence listed it — and "Continue with Discord" then
    // led to `/login?from=refused` after a full trip out and back (#401).
    const server = await build()
    const boss = await givenAccount({ roles: ['admin'] })
    await save(server, 'discord', boss.cookie, { client_id: 'client-1' })

    const installation = await server.inject({ method: 'GET', url: '/api/installation' })

    expect(installation.json().installation.social_logins).toEqual([])
  })

  it('takes the button away again when the secret is cleared', async () => {
    // The other direction, and the one that matters more: a provider that worked yesterday
    // and whose secret was emptied today must stop offering a trip.
    const server = await build()
    const boss = await givenAccount({ roles: ['admin'] })
    await save(server, 'discord', boss.cookie, { client_id: 'client-1', client_secret: 'hunter2' })

    await save(server, 'discord', boss.cookie, { client_id: 'client-1', client_secret: '' })

    const installation = await server.inject({ method: 'GET', url: '/api/installation' })
    expect(installation.json().installation.social_logins).toEqual([])
  })

  it('is admin’s alone, through the prefix hook', async () => {
    const server = await build()
    const wren = await givenAccount({ roles: ['member'] })

    expect((await read(server, 'facebook', wren.cookie)).statusCode).toBe(403)
    expect((await save(server, 'facebook', wren.cookie, { client_id: 'client-1' })).statusCode).toBe(403)
  })

  it('is a 404 for something that is not a provider', async () => {
    const server = await build()
    const boss = await givenAccount({ roles: ['admin'] })

    expect((await read(server, 'myspace', boss.cookie)).statusCode).toBe(404)
  })
})

describe('the state row itself', () => {
  it('cannot say it is a link without an account to link to', async () => {
    // The CHECK, which only a write skipping the API can exercise.
    await build()
    const client = handle?.client
    if (client === undefined) throw new Error('build() first')

    // Every other column supplied, and asserted on the message: omitting `nonce` made this
    // pass on NOT NULL instead, so the CHECK could have been deleted from the migration with
    // the test still green — "a mutation that does not apply looks exactly like one that was
    // caught".
    expect(() =>
      client
        .prepare(
          'insert into oauth_state (state, provider, intent, nonce, account_id, created_at) values (?, ?, ?, ?, ?, ?)',
        )
        .run('s-1', 'facebook', 'link', 'a-nonce', null, NOW.toISOString()),
    ).toThrow(/oauth_state_link_account_check/u)
  })

  it('goes with the account that started it', async () => {
    const server = await build()
    await givenProvider()
    const wren = await givenAccount()
    await startLink(server, 'facebook', wren.cookie)

    await db().delete(account).where(eq(account.id, wren.id))

    expect(await db().select().from(oauthState)).toEqual([])
  })
})
