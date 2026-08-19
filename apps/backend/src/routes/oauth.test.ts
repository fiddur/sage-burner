import type { FastifyInstance } from 'fastify'

import { eq } from 'drizzle-orm'
import { createHash, randomUUID } from 'node:crypto'
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
  application,
  inviteRedemption,
  inviteToken,
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
  identified = {}
})

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

let identified: { email?: string; name?: string; handle?: string } = {}

const fakeOAuth = (over: Partial<OAuthCalls> = {}): OAuthCalls => ({
  identify: () =>
    Promise.resolve({
      profile: { subject: 'provider-1', picture: 'https://cdn.example/face.png', ...identified },
    }),
  picture: () => Promise.resolve({ bytes: PNG, content_type: 'image/png' }),
  ...over,
})

const build = async (oauth: OAuthCalls = fakeOAuth(), logged?: string[]) => {
  handle = createDb({ url: ':memory:' })
  runMigrations(handle)
  app = await createApp({
    db: handle.db,
    config: createConfig({
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

const cookiesOn = (response: { headers: Record<string, unknown> }): string =>
  [response.headers['set-cookie'] ?? []].flat().join('\n')

const nonceFrom = (response: { headers: Record<string, unknown> }): string => {
  const header = String(response.headers['set-cookie'] ?? '')
  const value = /sage_oauth=([^;]*)/u.exec(header)?.[1]
  if (value === undefined || value === '') throw new Error('no nonce cookie was set')

  return `sage_oauth=${value}`
}

const mintedState = async () => {
  const [row] = await db().select().from(oauthState)
  if (row === undefined) throw new Error('no state was minted')
  return row.state
}

type LogLine = {
  msg: string
  reqId?: unknown
  provider?: unknown
  intent?: unknown
  at?: unknown
  status?: unknown
  said?: unknown
}

const isLogLine = (value: unknown): value is LogLine =>
  typeof value === 'object' && value !== null && 'msg' in value && typeof value.msg === 'string'

const lastLogLine = (chunks: readonly string[]): LogLine | undefined =>
  chunks
    .flatMap((chunk) => {
      const parsed: unknown = JSON.parse(chunk)

      return isLogLine(parsed) ? [parsed] : []
    })
    .at(-1)

const signInThrough = async (
  server: FastifyInstance,
  provider = 'facebook',
  profile: { email?: string; name?: string; handle?: string } = {},
) => {
  identified = profile
  const leaving = await start(server, provider)

  return await callback(server, provider, `code=abc&state=${await mintedState()}`, nonceFrom(leaving))
}

const signInFromInvite = async (
  server: FastifyInstance,
  token: string,
  profile: { email?: string; name?: string } = {},
  provider = 'facebook',
) => {
  identified = profile
  const leaving = await server.inject({
    method: 'GET',
    url: `/api/auth/oauth/${provider}?invite=${encodeURIComponent(token)}`,
  })

  return await callback(server, provider, `code=abc&state=${await mintedState()}`, nonceFrom(leaving))
}

const givenLink = async (over: { kind?: 'single' | 'group'; expires_at?: string; used_at?: string } = {}) => {
  const token = `token-${randomUUID()}`
  const admin = randomUUID()
  await db()
    .insert(account)
    .values({ id: admin, email: `${admin}@example.org`, password_hash: null, created_at: NOW.toISOString() })
  await db()
    .insert(inviteToken)
    .values({
      id: randomUUID(),
      token_hash: createHash('sha256').update(token).digest('hex'),
      kind: over.kind ?? 'group',
      label: over.kind === 'single' ? null : 'The Facebook group',
      application_id: null,
      expires_at: over.expires_at ?? '2027-01-01T00:00:00.000Z',
      used_at: over.used_at ?? null,
      created_by: admin,
    })

  return token
}

const linkThrough = async (
  server: FastifyInstance,
  cookie: string,
  provider = 'facebook',
  profile: { name?: string; handle?: string } = {},
) => {
  identified = profile
  const leaving = await startLink(server, provider, cookie)
  return await callback(server, provider, `code=abc&state=${await mintedState()}`, nonceFrom(leaving))
}

describe('signing up from an invite link through a provider', () => {
  it('makes a member in one round trip, which is what a link posted in the group is for', async () => {
    const server = await build()
    await givenProvider()
    const token = await givenLink()

    const back = await signInFromInvite(server, token, { email: 'wren@example.org', name: 'Wren' })

    expect(back.headers.location).toBe('/')
    expect(cookiesOn(back)).toContain(`${SESSION_COOKIE}=`)

    const [made] = await db().select().from(account).where(eq(account.email, 'wren@example.org'))
    expect(made).toBeDefined()
    expect(
      await db()
        .select()
        .from(accountRole)
        .where(eq(accountRole.account_id, made?.id ?? '')),
    ).toEqual([{ account_id: made?.id, role: 'member' }])
  })

  it('lands somebody who arrived without a name on their details, where the name is asked for', async () => {
    const server = await build()
    await givenProvider('discord')
    const token = await givenLink()

    const back = await signInFromInvite(server, token, { email: 'wren@example.org', name: 'ȐJaƔ' }, 'discord')

    expect(back.headers.location).toBe('/profile')
    expect(cookiesOn(back)).toContain(`${SESSION_COOKIE}=`)
    const [made] = await db().select().from(account).where(eq(account.email, 'wren@example.org'))
    expect(made?.name).toBeNull()
  })

  it('records the arrival against the link, and leaves invite_token_id null for a group one', async () => {
    const server = await build()
    await givenProvider()
    const token = await givenLink()

    await signInFromInvite(server, token, { email: 'wren@example.org' })

    const [made] = await db().select().from(account).where(eq(account.email, 'wren@example.org'))
    expect(made?.invite_token_id).toBeNull()
    const arrivals = await db().select().from(inviteRedemption)
    expect(arrivals).toHaveLength(1)
    expect(arrivals[0]?.account_id).toBe(made?.id)
  })

  it('spends a single-use link instead, stamping it and marking the account it made', async () => {
    const server = await build()
    await givenProvider()
    const token = await givenLink({ kind: 'single' })

    await signInFromInvite(server, token, { email: 'wren@example.org' })

    const [spent] = await db().select().from(inviteToken)
    expect(spent?.used_at).not.toBeNull()
    const [made] = await db().select().from(account).where(eq(account.email, 'wren@example.org'))
    expect(made?.invite_token_id).toBe(spent?.id)
  })

  it('makes no member of a link that has expired, and no account either', async () => {
    const server = await build()
    await givenProvider()
    const token = await givenLink({ expires_at: '2020-01-01T00:00:00.000Z' })

    const back = await signInFromInvite(server, token, { email: 'wren@example.org' })

    expect(back.headers.location).toBe('/login?from=refused')
    expect(await db().select().from(account).where(eq(account.email, 'wren@example.org'))).toEqual([])
  })

  it('makes no member of a single-use link already spent', async () => {
    const server = await build()
    await givenProvider()
    const token = await givenLink({ kind: 'single', used_at: NOW.toISOString() })

    const back = await signInFromInvite(server, token, { email: 'wren@example.org' })

    expect(back.headers.location).toBe('/login?from=refused')
    expect(await db().select().from(accountRole)).toEqual([])
  })

  it('makes no member of a link that has been revoked', async () => {
    const server = await build()
    await givenProvider()
    const token = await givenLink()
    await db().update(inviteToken).set({ revoked_at: NOW.toISOString() })

    const back = await signInFromInvite(server, token, { email: 'wren@example.org' })

    expect(back.headers.location).toBe('/login?from=refused')
    expect(await db().select().from(accountRole)).toEqual([])
  })

  it('lets one in where two arrive on the last place at once (#561)', async () => {
    let handed = 0
    const server = await build(
      fakeOAuth({
        identify: () => {
          handed += 1

          return Promise.resolve({
            profile: { subject: `provider-${handed}`, email: `wren${handed}@example.org` },
          })
        },
      }),
    )
    await givenProvider()
    const token = await givenLink()
    await db().update(inviteToken).set({ max_uses: 1 })

    const states = async () => (await db().select().from(oauthState)).map((row) => row.state)

    const leavingOne = await server.inject({
      method: 'GET',
      url: `/api/auth/oauth/facebook?invite=${encodeURIComponent(token)}`,
    })
    const [stateOne] = await states()

    const leavingTwo = await server.inject({
      method: 'GET',
      url: `/api/auth/oauth/facebook?invite=${encodeURIComponent(token)}`,
    })
    const stateTwo = (await states()).find((one) => one !== stateOne)

    await Promise.all([
      callback(server, 'facebook', `code=a&state=${stateOne ?? ''}`, nonceFrom(leavingOne)),
      callback(server, 'facebook', `code=b&state=${stateTwo ?? ''}`, nonceFrom(leavingTwo)),
    ])

    expect(await db().select().from(inviteRedemption)).toHaveLength(1)
  })

  it('makes no member of a group link with no room left on it', async () => {
    const server = await build()
    await givenProvider()
    const token = await givenLink()
    const [link] = await db().select().from(inviteToken)
    await db().update(inviteToken).set({ max_uses: 1 })
    const first = randomUUID()
    await db()
      .insert(account)
      .values({
        id: first,
        email: `${first}@example.org`,
        password_hash: null,
        created_at: NOW.toISOString(),
      })
    await db()
      .insert(inviteRedemption)
      .values({
        id: randomUUID(),
        token_id: link?.id ?? '',
        account_id: first,
        redeemed_at: NOW.toISOString(),
      })

    const back = await signInFromInvite(server, token, { email: 'wren@example.org' })

    expect(back.headers.location).toBe('/login?from=refused')
    expect(await db().select().from(account).where(eq(account.email, 'wren@example.org'))).toEqual([])
  })

  it('makes no member of a token nobody minted', async () => {
    const server = await build()
    await givenProvider()

    const back = await signInFromInvite(server, 'not-a-real-token', { email: 'wren@example.org' })

    expect(back.headers.location).toBe('/login?from=refused')
    expect(await db().select().from(account).where(eq(account.email, 'wren@example.org'))).toEqual([])
  })

  it('says the link ran out, not that the address is taken, when another account already holds it', async () => {
    const server = await build()
    await givenProvider()
    const token = await givenLink({ kind: 'single' })
    const [link] = await db().select().from(inviteToken)
    const first = randomUUID()
    await db()
      .insert(account)
      .values({
        id: first,
        email: `${first}@example.org`,
        password_hash: null,
        invite_token_id: link?.id ?? null,
        created_at: NOW.toISOString(),
      })

    const back = await signInFromInvite(server, token, { email: 'wren@example.org' })

    expect(back.headers.location).toBe('/login?from=refused')
    expect(await db().select().from(account).where(eq(account.email, 'wren@example.org'))).toEqual([])
  })

  it('makes no member without one, which is the ordinary sign-up it was before', async () => {
    const server = await build()
    await givenProvider()

    const back = await signInThrough(server, 'facebook', { email: 'wren@example.org' })

    expect(back.headers.location).toBe('/apply')
    expect(await db().select().from(accountRole)).toEqual([])
  })
})

describe('taking up an invite as somebody the provider already knows', () => {
  const givenIdentity = async (over: { roles?: ('admin' | 'member')[] } = {}) => {
    const id = randomUUID()
    await db()
      .insert(account)
      .values({ id, email: `${id}@example.org`, password_hash: null, created_at: NOW.toISOString() })
    for (const role of over.roles ?? []) await db().insert(accountRole).values({ account_id: id, role })
    await db().insert(accountIdentity).values({
      id: randomUUID(),
      account_id: id,
      provider: 'facebook',
      subject: 'provider-1',
      profile_url: null,
      created_at: NOW.toISOString(),
    })

    return id
  }

  it('makes a member of an account that has no role yet, the link being the vetting', async () => {
    const server = await build()
    await givenProvider()
    const id = await givenIdentity()
    const token = await givenLink()

    const back = await signInFromInvite(server, token)

    expect(back.headers.location).toBe('/')
    expect(await db().select().from(accountRole).where(eq(accountRole.account_id, id))).toEqual([
      { account_id: id, role: 'member' },
    ])
  })

  it('records the arrival against the group link it came on', async () => {
    const server = await build()
    await givenProvider()
    const id = await givenIdentity()
    const token = await givenLink()

    await signInFromInvite(server, token)

    const arrivals = await db().select().from(inviteRedemption)
    expect(arrivals).toHaveLength(1)
    expect(arrivals[0]?.account_id).toBe(id)
  })

  it('spends a single-use link, stamping it and marking the account it admitted', async () => {
    const server = await build()
    await givenProvider()
    const id = await givenIdentity()
    const token = await givenLink({ kind: 'single' })

    await signInFromInvite(server, token)

    const [spent] = await db().select().from(inviteToken)
    expect(spent?.used_at).not.toBeNull()
    const [admitted] = await db().select().from(account).where(eq(account.id, id))
    expect(admitted?.invite_token_id).toBe(spent?.id)
  })

  it('leaves a link alone for somebody who is already a member', async () => {
    const server = await build()
    await givenProvider()
    await givenIdentity({ roles: ['member'] })
    const token = await givenLink()

    const back = await signInFromInvite(server, token)

    expect(back.headers.location).toBe('/')
    expect(await db().select().from(inviteRedemption)).toEqual([])
  })

  it('signs somebody in without a role on a link that has run out', async () => {
    const server = await build()
    await givenProvider()
    const id = await givenIdentity()
    const token = await givenLink({ expires_at: '2020-01-01T00:00:00.000Z' })

    const back = await signInFromInvite(server, token)

    expect(back.headers.location).toBe('/')
    expect(cookiesOn(back)).toContain(`${SESSION_COOKIE}=`)
    expect(await db().select().from(accountRole).where(eq(accountRole.account_id, id))).toEqual([])
  })

  it('leaves an admin alone as well, a role of any kind being an account that is already in', async () => {
    const server = await build()
    await givenProvider()
    const id = await givenIdentity({ roles: ['admin'] })
    const token = await givenLink()

    await signInFromInvite(server, token)

    expect(await db().select().from(accountRole).where(eq(accountRole.account_id, id))).toEqual([
      { account_id: id, role: 'admin' },
    ])
  })

  const givenApplication = async (accountId: string, status: 'pending' | 'rejected' = 'pending') => {
    const id = randomUUID()
    await db()
      .insert(application)
      .values({
        id,
        answers: [{ question_id: randomUUID(), label: 'Why?', type: 'text', value: 'because' }],
        status,
        account_id: accountId,
        applicant_name: 'Waiting Wren',
        applicant_email: `${accountId}@example.org`,
        submitted_at: '2026-07-01T00:00:00.000Z',
        decided_at: status === 'pending' ? null : '2026-07-01T12:00:00.000Z',
      })

    return id
  }

  it("settles the admitted account's pending application, so the queue stops offering a decision", async () => {
    const server = await build()
    await givenProvider()
    const id = await givenIdentity()
    await givenApplication(id)
    const token = await givenLink()

    await signInFromInvite(server, token)

    const [settled] = await db().select().from(application).where(eq(application.account_id, id))
    expect(settled?.status).toBe('approved')
  })

  it('stamps that decision with the moment the link was pressed', async () => {
    const server = await build()
    await givenProvider()
    const id = await givenIdentity()
    await givenApplication(id)
    const token = await givenLink()
    clock = new Date('2026-07-03T09:00:00.000Z')

    await signInFromInvite(server, token)

    const [settled] = await db().select().from(application).where(eq(application.account_id, id))
    expect(settled?.decided_at).toBe('2026-07-03T09:00:00.000Z')
  })

  it('settles a rejected one too, rather than telling somebody holding member they were turned down', async () => {
    const server = await build()
    await givenProvider()
    const id = await givenIdentity()
    await givenApplication(id, 'rejected')
    const token = await givenLink()

    await signInFromInvite(server, token)

    const [settled] = await db().select().from(application).where(eq(application.account_id, id))
    expect(settled?.status).toBe('approved')
  })

  it('leaves another applicant waiting where they were', async () => {
    const server = await build()
    await givenProvider()
    const id = await givenIdentity()
    const other = await givenAccount({ roles: [], password: null })
    await givenApplication(other.id)
    await givenApplication(id)
    const token = await givenLink()

    await signInFromInvite(server, token)

    const [untouched] = await db().select().from(application).where(eq(application.account_id, other.id))
    expect(untouched?.status).toBe('pending')
  })

  it('settles nothing where the link has run out, the role not having been granted either', async () => {
    const server = await build()
    await givenProvider()
    const id = await givenIdentity()
    await givenApplication(id)
    const token = await givenLink({ expires_at: '2020-01-01T00:00:00.000Z' })

    await signInFromInvite(server, token)

    const [waiting] = await db().select().from(application).where(eq(application.account_id, id))
    expect(waiting?.status).toBe('pending')
    expect(await db().select().from(accountRole).where(eq(accountRole.account_id, id))).toEqual([])
  })

  it('leaves the date on a decision already made, for somebody whose roles were taken off', async () => {
    const server = await build()
    await givenProvider()
    const id = await givenIdentity()
    const paper = await givenApplication(id)
    await db()
      .update(application)
      .set({ status: 'approved', decided_at: '2026-07-01T12:00:00.000Z' })
      .where(eq(application.id, paper))
    const token = await givenLink()
    clock = new Date('2026-07-03T09:00:00.000Z')

    await signInFromInvite(server, token)

    const [settled] = await db().select().from(application).where(eq(application.account_id, id))
    expect(settled?.decided_at).toBe('2026-07-01T12:00:00.000Z')
  })

  it('admits somebody already counted against a group link, whose roles were taken off since', async () => {
    const server = await build()
    await givenProvider()
    const id = await givenIdentity()
    const first = await givenLink()
    await signInFromInvite(server, first)
    await db().delete(accountRole).where(eq(accountRole.account_id, id))

    await signInFromInvite(server, await givenLink())

    expect(await db().select().from(accountRole).where(eq(accountRole.account_id, id))).toEqual([
      { account_id: id, role: 'member' },
    ])
  })

  it('counts them once all the same, the redemption being per account', async () => {
    const server = await build()
    await givenProvider()
    const id = await givenIdentity()
    await signInFromInvite(server, await givenLink())
    await db().delete(accountRole).where(eq(accountRole.account_id, id))

    await signInFromInvite(server, await givenLink())

    expect(await db().select().from(inviteRedemption)).toHaveLength(1)
  })
})

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
    expect(to.searchParams.get('scope')).toBe('identify email')
    expect(to.searchParams.get('state')).toBe(await mintedState())
  })

  it('asks for an address, which is what an account is keyed by', async () => {
    const server = await build()
    await givenProvider('facebook')

    const to = new URL((await start(server, 'facebook')).headers.location?.toString() ?? '')

    expect(to.searchParams.get('scope')).toBe('public_profile,email')
  })

  it('asks for the profile link only where the app has been approved for it', async () => {
    const server = await build()
    await givenProvider('facebook', { ask_profile_link: true })

    const asking = new URL((await start(server, 'facebook')).headers.location?.toString() ?? '')

    expect(asking.searchParams.get('scope')).toBe('public_profile,email,user_link')

    await db().delete(oauthSetting)
    await givenProvider('facebook', { ask_profile_link: false })

    const not = new URL((await start(server, 'facebook')).headers.location?.toString() ?? '')

    expect(not.searchParams.get('scope')).toBe('public_profile,email')
  })

  it('calls a provider nobody has set up misconfigured, rather than sending somebody nowhere', async () => {
    const server = await build()

    const leaving = await start(server, 'facebook')

    expect(leaving.headers.location).toMatch(/^\/login\?from=misconfigured&ref=/u)
    expect(await db().select().from(oauthState)).toEqual([])
  })

  it('sends somebody linking to their own details, not to the login page', async () => {
    const server = await build()
    const wren = await givenAccount()

    const leaving = await startLink(server, 'facebook', wren.cookie)

    expect(leaving.headers.location).toMatch(/^\/profile\?from=misconfigured&ref=/u)
  })

  it('writes why it could not set off, where an admin can read it', async () => {
    const logged: string[] = []
    const server = await build(fakeOAuth(), logged)

    await start(server, 'facebook')

    const line = lastLogLine(logged)
    expect(line?.msg).toBe('could not set off for a provider')
    expect(line?.at).toBe('setting')
    expect(line?.provider).toBe('facebook')
  })

  it('quotes the reference that is on that very log line', async () => {
    const logged: string[] = []
    const server = await build(fakeOAuth(), logged)

    const leaving = await start(server, 'facebook')

    const quoted = /ref=([^&]+)/u.exec(String(leaving.headers.location))?.[1]
    expect(quoted).toBeDefined()
    expect(lastLogLine(logged)?.reqId).toBe(quoted)
  })

  it('is a 404 for something that is not a provider at all', async () => {
    const server = await build()

    expect((await start(server, 'myspace')).statusCode).toBe(404)
    expect((await callback(server, 'myspace', 'code=a&state=b')).statusCode).toBe(404)
  })

  it('sends somebody whose session has gone to the login page, not a JSON 401', async () => {
    const server = await build()
    await givenProvider()

    const refused = await startLink(server, 'facebook')

    expect(refused.statusCode).toBe(302)
    expect(refused.headers.location).toBe('/login')
  })

  it('will not leave for a provider whose secret is empty', async () => {
    const server = await build()
    await db().insert(oauthSetting).values({
      provider: 'discord',
      client_id: 'client-1',
      client_secret: '',
      updated_at: NOW.toISOString(),
    })

    const leaving = await start(server, 'discord')

    expect(leaving.headers.location).toMatch(/^\/login\?from=misconfigured&ref=/u)
  })

  it('starts a link for somebody with no role at all', async () => {
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

  it('makes an account for an identity nobody has yet, with no roles on it', async () => {
    const server = await build()
    await givenProvider()

    const back = await signInThrough(server, 'facebook', { email: 'wren@example.org' })

    expect(back.headers.location).toBe('/apply')
    expect(cookiesOn(back)).toContain(`${SESSION_COOKIE}=`)
    const [made] = await db().select().from(account)
    expect(made?.email).toBe('wren@example.org')
    expect(await db().select().from(accountRole)).toEqual([])
  })

  it('signs the same identity back into the account it made, rather than making a second', async () => {
    const server = await build()
    await givenProvider()
    await signInThrough(server, 'facebook', { email: 'wren@example.org' })

    const again = await signInThrough(server, 'facebook', { email: 'wren@example.org' })

    expect(again.headers.location).toBe('/')
    expect(await db().select().from(account)).toHaveLength(1)
  })

  it('puts the address in the contact list, as every other way in does', async () => {
    const server = await build()
    await givenProvider()

    await signInThrough(server, 'facebook', { email: 'wren@example.org' })

    const rows = await db().select().from(accountConnection)
    expect(rows.map((row) => [row.kind, row.value])).toContainEqual(['email', 'wren@example.org'])
  })

  it('makes no account where the provider offers no address, and says where to go instead', async () => {
    const server = await build()
    await givenProvider()

    const back = await signInThrough(server)

    expect(back.headers.location).toBe('/apply?from=no-address')
    expect(cookiesOn(back)).not.toContain(`${SESSION_COOKIE}=`)
    expect(await db().select().from(account)).toEqual([])
  })

  it('takes the name Facebook gives, since the account carries the person and that is their name', async () => {
    const server = await build()
    await givenProvider()

    await signInThrough(server, 'facebook', { email: 'wren@example.org', name: 'Wren' })

    const [made] = await db().select().from(account)
    expect(made?.name).toBe('Wren')
  })

  it('leaves the name empty for Discord, whose display name is rarely a real one', async () => {
    const server = await build()
    await givenProvider('discord')

    await signInThrough(server, 'discord', { email: 'wren@example.org', name: 'ȐJaƔ', handle: 'robby5859' })

    const [made] = await db().select().from(account)
    expect(made?.name).toBeNull()
  })

  it('keeps what the provider calls them on the identity, for the review card to say', async () => {
    const server = await build()
    await givenProvider('discord')

    await signInThrough(server, 'discord', { email: 'wren@example.org', name: 'ȐJaƔ', handle: 'robby5859' })

    const [identity] = await db().select().from(accountIdentity)
    expect(identity).toMatchObject({ provider: 'discord', name: 'ȐJaƔ', handle: 'robby5859' })
  })

  it('refreshes what the provider calls them on each sign-in, leaving alone what was not answered', async () => {
    const server = await build()
    await givenProvider('discord')
    const wren = await givenAccount()
    await db().insert(accountIdentity).values({
      id: randomUUID(),
      account_id: wren.id,
      provider: 'discord',
      subject: 'provider-1',
      name: 'old name',
      handle: 'oldhandle',
      created_at: NOW.toISOString(),
    })

    await signInThrough(server, 'discord', { name: 'new name' })

    const [identity] = await db().select().from(accountIdentity)
    expect(identity).toMatchObject({ name: 'new name', handle: 'oldhandle' })
  })

  it('folds the case of the address, as every other way in does', async () => {
    const server = await build()
    await givenProvider()

    await signInThrough(server, 'facebook', { email: '  Wren@Example.org  ' })

    const [made] = await db().select().from(account)
    expect(made?.email).toBe('wren@example.org')
  })

  it('recognises an existing address however the provider spelled it', async () => {
    const server = await build()
    await givenProvider()
    await signInThrough(server, 'facebook', { email: 'wren@example.org' })
    await db().delete(accountIdentity)

    const back = await signInThrough(server, 'facebook', { email: 'WREN@example.org' })

    expect(back.headers.location).toBe('/login?from=address-taken')
    expect(await db().select().from(account)).toHaveLength(1)
  })

  it('asks for an address where the provider gave something that is not one', async () => {
    const server = await build()
    await givenProvider()

    const back = await signInThrough(server, 'facebook', { email: 'not-an-address' })

    expect(back.headers.location).toBe('/apply?from=no-address')
    expect(await db().select().from(account)).toEqual([])
  })

  it('refuses an address somebody already holds, rather than linking a stranger onto it', async () => {
    const server = await build()
    await givenProvider()
    const wren = await givenAccount()
    const [held] = await db().select().from(account).where(eq(account.id, wren.id))

    const back = await signInThrough(server, 'facebook', { email: held?.email ?? '' })

    expect(back.headers.location).toBe('/login?from=address-taken')
    expect(cookiesOn(back)).not.toContain(`${SESSION_COOKIE}=`)
    expect(await db().select().from(accountIdentity)).toEqual([])
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
    const server = await build()
    await givenProvider()
    await start(server, 'facebook')

    const back = await callback(server, 'facebook', 'error=access_denied')

    expect(back.headers.location).toBe('/login?from=refused')
    expect(await db().select().from(oauthState)).toHaveLength(1)
  })

  it('refuses a callback that comes back to a different browser', async () => {
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
    const server = await build()
    await givenProvider()
    await start(server, 'facebook')
    await start(server, 'facebook')
    expect(await db().select().from(oauthState)).toHaveLength(2)

    clock = new Date(NOW.getTime() + (STATE_TTL_SECONDS + 1) * 1000)
    await start(server, 'facebook')

    expect(await db().select().from(oauthState)).toHaveLength(1)
  })

  it('refuses when the provider cannot be talked to', async () => {
    const server = await build(
      fakeOAuth({ identify: () => Promise.resolve({ failed: { at: 'token' as const, status: 400 } }) }),
    )
    await givenProvider()

    expect((await signInThrough(server)).headers.location).toContain('from=misconfigured')
  })
})

describe('why a link could not be made', () => {
  it('writes the provider’s reason to the log, where an admin can read it', async () => {
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

    expect(back.headers.location).toContain('from=misconfigured')

    const line = lastLogLine(logged)
    expect(line?.at).toBe('token')
    expect(line?.status).toBe(400)
    expect(line?.said).toBe('Error validating client secret.')
    expect(line?.provider).toBe('facebook')
    expect(line?.intent).toBe('link')
  })

  it('tells the member it is misconfigured, with something to quote', async () => {
    const logged: string[] = []
    const server = await build(
      fakeOAuth({
        identify: () => Promise.resolve({ failed: { at: 'token' as const, status: 401 } }),
      }),
      logged,
    )
    await givenProvider('discord')
    const wren = await givenAccount()

    const back = await linkThrough(server, wren.cookie, 'discord')
    const to = new URL(back.headers.location?.toString() ?? '', 'https://burn.example')

    expect(to.pathname).toBe('/profile')
    expect(to.searchParams.get('from')).toBe('misconfigured')
    expect(to.searchParams.get('ref')).toBe(String(lastLogLine(logged)?.reqId ?? ''))
  })

  it('tells them to try again when nothing arrived', async () => {
    const server = await build(
      fakeOAuth({ identify: () => Promise.resolve({ failed: { at: 'network' as const } }) }),
    )
    await givenProvider('discord')
    const wren = await givenAccount()

    const back = await linkThrough(server, wren.cookie, 'discord')

    expect(back.headers.location).toContain('from=unreachable')
  })

  it('calls a provider having a bad day unreachable rather than misconfigured', async () => {
    const server = await build(
      fakeOAuth({
        identify: () => Promise.resolve({ failed: { at: 'token' as const, status: 503 } }),
      }),
    )
    await givenProvider('discord')
    const wren = await givenAccount()

    const back = await linkThrough(server, wren.cookie, 'discord')

    expect(back.headers.location).toContain('from=unreachable')
  })

  it('sends somebody signing in to the login page, not to Your details', async () => {
    const server = await build(
      fakeOAuth({
        identify: () => Promise.resolve({ failed: { at: 'token' as const, status: 401 } }),
      }),
    )
    await givenProvider('discord')

    const back = await signInThrough(server, 'discord')

    expect(back.headers.location).toContain('/login?from=misconfigured')
  })

  it('calls a rate-limited provider unreachable, since waiting is the fix', async () => {
    const server = await build(
      fakeOAuth({
        identify: () => Promise.resolve({ failed: { at: 'token' as const, status: 429 } }),
      }),
    )
    await givenProvider('discord')
    const wren = await givenAccount()

    const back = await linkThrough(server, wren.cookie, 'discord')

    expect(back.headers.location).toContain('from=unreachable')
  })

  it('writes nothing about somebody who was identified', async () => {
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

  it('never writes a way of being reached from the app-scoped id Facebook hands over', async () => {
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
    const server = await build()
    await givenProvider('facebook')
    const wren = await givenAccount()

    await linkThrough(server, wren.cookie, 'facebook')

    const [written] = await db().select().from(accountIdentity)
    expect(written?.profile_url).toBeNull()
  })

  it('keeps what the provider calls them, without touching the account’s own name', async () => {
    const server = await build()
    await givenProvider('discord')
    const wren = await givenAccount()
    await db().update(account).set({ name: 'Wren' }).where(eq(account.id, wren.id))

    await linkThrough(server, wren.cookie, 'discord', { name: 'ȐJaƔ', handle: 'robby5859' })

    const [written] = await db().select().from(accountIdentity)
    expect(written).toMatchObject({ name: 'ȐJaƔ', handle: 'robby5859' })
    const [held] = await db().select().from(account).where(eq(account.id, wren.id))
    expect(held?.name).toBe('Wren')
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
    const server = await build()
    await givenProvider('discord')
    await givenProvider('facebook')
    const wren = await givenAccount({ password: null })
    await linkThrough(server, wren.cookie, 'discord')
    await linkThrough(server, wren.cookie, 'facebook')

    expect((await forget(server, 'facebook', wren.cookie)).statusCode).toBe(204)
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
    payload: { client_id: string; client_secret?: string },
  ) =>
    server.inject({
      method: 'PUT',
      url: `/api/admin/installation/oauth/${provider}`,
      headers: { cookie },
      payload,
    })

  it('stores the secret without the whitespace a paste brings with it', async () => {
    const server = await build()
    const boss = await givenAccount({ roles: ['admin'] })

    await save(server, 'facebook', boss.cookie, {
      client_id: '  client-1\n',
      client_secret: '  hunter2\n',
    })

    const [row] = await db().select().from(oauthSetting)
    expect(row).toMatchObject({ client_id: 'client-1', client_secret: 'hunter2' })
  })

  it('leaves a secret with no whitespace exactly as it is', async () => {
    const server = await build()
    const boss = await givenAccount({ roles: ['admin'] })

    await save(server, 'facebook', boss.cookie, { client_id: 'client-1', client_secret: 'a b-c_d.e' })

    const [row] = await db().select().from(oauthSetting)
    expect(row?.client_secret).toBe('a b-c_d.e')
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
    const server = await build()
    const boss = await givenAccount({ roles: ['admin'] })
    await save(server, 'discord', boss.cookie, { client_id: 'client-1' })

    const installation = await server.inject({ method: 'GET', url: '/api/installation' })

    expect(installation.json().installation.social_logins).toEqual([])
  })

  it('takes the button away again when the secret is cleared', async () => {
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
    await build()
    const client = handle?.client
    if (client === undefined) throw new Error('build() first')

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

describe('what a link adds to how people can reach you', () => {
  const reaching = (over: { value?: string } = {}) =>
    fakeOAuth({
      identify: () =>
        Promise.resolve({
          profile: { subject: 'discord-1', reach: { kind: 'discord', value: over.value ?? 'wren' } },
        }),
    })

  const listed = async (accountId: string) =>
    await db().select().from(accountConnection).where(eq(accountConnection.account_id, accountId))

  const forget = (server: FastifyInstance, provider: string, cookie: string) =>
    server.inject({ method: 'DELETE', url: `/api/me/identities/${provider}`, headers: { cookie } })

  it('adds the handle the provider answered, and says that it did', async () => {
    const server = await build(reaching())
    await givenProvider('discord')
    const wren = await givenAccount()

    const back = await linkThrough(server, wren.cookie, 'discord')

    expect(back.headers.location).toBe('/profile?from=reached')
    expect(await listed(wren.id)).toMatchObject([
      { kind: 'discord', value: 'wren', label: '', from_provider: 'discord' },
    ])
  })

  it('publishes none of it for somebody signing in rather than linking', async () => {
    const server = await build(reaching())
    await givenProvider('discord')
    const wren = await givenAccount()
    await db().insert(accountIdentity).values({
      id: randomUUID(),
      account_id: wren.id,
      provider: 'discord',
      subject: 'discord-1',
      profile_url: null,
      created_at: NOW.toISOString(),
    })

    const back = await signInThrough(server, 'discord')

    expect(back.headers.location).toBe('/')
    expect(await listed(wren.id)).toEqual([])
  })

  it('adds nothing for a provider with no handle to offer, and says only that it linked', async () => {
    const server = await build()
    await givenProvider('facebook')
    const wren = await givenAccount()

    const back = await linkThrough(server, wren.cookie, 'facebook')

    expect(back.headers.location).toBe('/profile?from=linked')
    expect(await listed(wren.id)).toEqual([])
  })

  it('leaves a row of that kind alone, whatever it holds', async () => {
    const server = await build(reaching())
    await givenProvider('discord')
    const wren = await givenAccount()
    await db().insert(accountConnection).values({
      id: 'c-1',
      account_id: wren.id,
      kind: 'discord',
      value: 'typed-by-hand',
      label: '',
      order: 0,
    })

    const back = await linkThrough(server, wren.cookie, 'discord')

    expect(back.headers.location).toBe('/profile?from=linked')
    expect(await listed(wren.id)).toMatchObject([{ value: 'typed-by-hand', from_provider: null }])
  })

  it('takes back what it added when the link is taken off', async () => {
    const server = await build(reaching())
    await givenProvider('discord')
    const wren = await givenAccount({ password: 'hashed' })
    await linkThrough(server, wren.cookie, 'discord')

    expect((await forget(server, 'discord', wren.cookie)).statusCode).toBe(204)
    expect(await listed(wren.id)).toEqual([])
  })

  it('leaves what somebody typed themselves when the link is taken off', async () => {
    const server = await build(reaching())
    await givenProvider('discord')
    const wren = await givenAccount({ password: 'hashed' })
    await db().insert(accountConnection).values({
      id: 'c-1',
      account_id: wren.id,
      kind: 'email',
      value: 'wren@example.org',
      label: '',
      order: 0,
    })
    await linkThrough(server, wren.cookie, 'discord')

    await forget(server, 'discord', wren.cookie)

    expect(await listed(wren.id)).toMatchObject([{ kind: 'email', value: 'wren@example.org' }])
  })

  it('leaves a row behind once somebody has changed it themselves', async () => {
    const server = await build(reaching())
    await givenProvider('discord')
    const wren = await givenAccount({ password: 'hashed' })
    await linkThrough(server, wren.cookie, 'discord')
    const [added] = await listed(wren.id)

    const changed = await server.inject({
      method: 'PATCH',
      url: `/api/me/connections/${added?.id ?? ''}`,
      headers: { cookie: wren.cookie },
      payload: { kind: 'discord', value: 'wren_2', label: '' },
    })
    expect(changed.statusCode).toBe(200)

    await forget(server, 'discord', wren.cookie)

    expect(await listed(wren.id)).toMatchObject([{ value: 'wren_2', from_provider: null }])
  })

  it('keeps the provenance out of the row a change answers with', async () => {
    const server = await build(reaching())
    await givenProvider('discord')
    const wren = await givenAccount()
    await linkThrough(server, wren.cookie, 'discord')
    const [added] = await listed(wren.id)

    const changed = await server.inject({
      method: 'PATCH',
      url: `/api/me/connections/${added?.id ?? ''}`,
      headers: { cookie: wren.cookie },
      payload: { kind: 'discord', value: 'wren_2', label: '' },
    })

    expect(changed.payload).not.toContain('from_provider')
  })

  it('keeps the provenance out of what the browser is told', async () => {
    const server = await build(reaching())
    await givenProvider('discord')
    const wren = await givenAccount()
    await linkThrough(server, wren.cookie, 'discord')

    const mine = await server.inject({
      method: 'GET',
      url: '/api/me/connections',
      headers: { cookie: wren.cookie },
    })

    expect(mine.json().connections).toMatchObject([{ kind: 'discord', value: 'wren' }])
    expect(mine.payload).not.toContain('from_provider')
  })
})
