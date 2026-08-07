import type { PasskeyLogin, PasskeyRegistration } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { isoBase64URL, isoCBOR } from '@simplewebauthn/server/helpers'
import { eq } from 'drizzle-orm'
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from '../db/index.ts'

import { createApp } from '../app.ts'
import { hashPassword } from '../auth/password.ts'
import { createConfig } from '../config.ts'
import { createDb, runMigrations } from '../db/index.ts'
import { account, passkey, webauthnChallenge } from '../db/schema.ts'

/**
 * The passkey ceremonies against the real verifier.
 *
 * Nothing here is stubbed, which is the point: what is worth testing about a
 * WebAuthn route is exactly the part a stub would replace. So the suite carries a
 * small authenticator — a P-256 key, `authenticatorData`, a CBOR attestation
 * object and a real ECDSA signature — and the routes verify its output the same
 * way they would verify a phone's.
 *
 * That also makes the negative tests mean something: a flipped byte in the
 * signature or a challenge already spent fails here because the library rejects
 * it, not because a mock was told to.
 */

const ORIGIN = 'https://burn.example.org'
const RP_ID = 'burn.example.org'
const NOW = new Date('2026-08-05T12:00:00.000Z')
const cheap = { cost: 2 ** 12, blockSize: 8, parallelism: 1 }

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

const build = async (env: NodeJS.ProcessEnv = {}) => {
  handle = createDb({ url: ':memory:' })
  runMigrations(handle)
  app = await createApp({
    db: handle.db,
    config: createConfig({ LOG_LEVEL: 'silent', SESSION_SECRET: 's'.repeat(40), ...env }),
    now: () => clock,
  })
  return app
}

const db = () => {
  const found = handle?.db
  if (found === undefined) throw new Error('build() first')
  return found
}

const givenAccount = async (email: string, password?: string) => {
  const id = randomUUID()
  await db()
    .insert(account)
    .values({
      id,
      email,
      name: 'Ada',
      password_hash: password === undefined ? null : await hashPassword(password, cheap),
      created_at: NOW.toISOString(),
    })

  return id
}

const cookieFrom = (response: { headers: Record<string, unknown> }) => {
  const header = response.headers['set-cookie']
  return typeof header === 'string' ? header : ''
}

const signIn = async (server: FastifyInstance, email: string, password: string) =>
  cookieFrom(await server.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } }))

const post = (server: FastifyInstance, url: string, cookie: string, payload?: object) =>
  server.inject({
    method: 'POST',
    url,
    headers: cookie === '' ? { origin: ORIGIN } : { origin: ORIGIN, cookie },
    payload,
  })

// --- a small authenticator -------------------------------------------------

const utf8 = (text: string) => new TextEncoder().encode(text)

const concat = (...parts: Uint8Array[]) => {
  const whole = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let at = 0
  for (const part of parts) {
    whole.set(part, at)
    at += part.length
  }
  return whole
}

const sha256 = (bytes: Uint8Array) => new Uint8Array(createHash('sha256').update(bytes).digest())

/** rpIdHash ‖ flags ‖ signCount, and the attested credential when registering. */
const authenticatorData = (flags: number, counter: number, attested?: Uint8Array) => {
  const head = new Uint8Array(37)
  head.set(sha256(utf8(RP_ID)), 0)
  head[32] = flags
  new DataView(head.buffer).setUint32(33, counter)

  return attested === undefined ? head : concat(head, attested)
}

const clientData = (type: string, challenge: string, origin = ORIGIN) =>
  utf8(JSON.stringify({ type, challenge, origin, crossOrigin: false }))

/** User present, user verified, and — for a registration — attested key included. */
const PRESENT_AND_VERIFIED = 0x05
const WITH_ATTESTED_KEY = 0x40

const makeAuthenticator = () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const credentialId = randomBytes(32)
  const jwk = publicKey.export({ format: 'jwk' })

  if (jwk.x === undefined || jwk.y === undefined) throw new Error('no P-256 coordinates')

  // COSE_Key for ES256: kty EC2, alg -7, crv P-256, then the two coordinates.
  const coseKey = isoCBOR.encode(
    new Map<string | number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, isoBase64URL.toBuffer(jwk.x)],
      [-3, isoBase64URL.toBuffer(jwk.y)],
    ]),
  )

  const attested = concat(
    new Uint8Array(16),
    new Uint8Array([credentialId.length >> 8, credentialId.length & 0xff]),
    credentialId,
    coseKey,
  )

  return {
    id: isoBase64URL.fromBuffer(credentialId),

    register: (challenge: string, origin = ORIGIN): PasskeyRegistration['response'] => {
      const authData = authenticatorData(PRESENT_AND_VERIFIED | WITH_ATTESTED_KEY, 0, attested)
      const attestationObject = isoCBOR.encode(
        new Map<string, string | Uint8Array | Map<string, string>>([
          ['fmt', 'none'],
          ['attStmt', new Map<string, string>()],
          ['authData', authData],
        ]),
      )

      return {
        id: isoBase64URL.fromBuffer(credentialId),
        rawId: isoBase64URL.fromBuffer(credentialId),
        response: {
          clientDataJSON: isoBase64URL.fromBuffer(clientData('webauthn.create', challenge, origin)),
          attestationObject: isoBase64URL.fromBuffer(attestationObject),
          transports: ['internal', 'hybrid'],
        },
        clientExtensionResults: {},
        type: 'public-key',
      }
    },

    assert: (challenge: string, counter = 1, origin = ORIGIN): PasskeyLogin['response'] => {
      const authData = authenticatorData(PRESENT_AND_VERIFIED, counter)
      const json = clientData('webauthn.get', challenge, origin)
      const signature = sign('sha256', concat(authData, sha256(json)), privateKey)

      return {
        id: isoBase64URL.fromBuffer(credentialId),
        rawId: isoBase64URL.fromBuffer(credentialId),
        response: {
          clientDataJSON: isoBase64URL.fromBuffer(json),
          authenticatorData: isoBase64URL.fromBuffer(authData),
          signature: isoBase64URL.fromBuffer(new Uint8Array(signature)),
        },
        clientExtensionResults: {},
        type: 'public-key',
      }
    },
  }
}

// --- the ceremonies --------------------------------------------------------

const challengeFrom = (response: { json: () => { options: { challenge: string } } }) =>
  response.json().options.challenge

/** Register one passkey and answer the cookie that was used to do it. */
const givenPasskey = async (server: FastifyInstance, cookie: string, label = 'Phone') => {
  const authenticator = makeAuthenticator()
  const started = await post(server, '/api/me/passkeys/challenge', cookie)
  const added = await post(server, '/api/me/passkeys', cookie, {
    label,
    response: authenticator.register(challengeFrom(started)),
  })

  return { authenticator, added }
}

const loginWith = async (
  server: FastifyInstance,
  authenticator: ReturnType<typeof makeAuthenticator>,
  counter = 1,
) => {
  const started = await post(server, '/api/auth/passkey/challenge', '')
  return post(server, '/api/auth/passkey/login', '', {
    response: authenticator.assert(challengeFrom(started), counter),
  })
}

describe('registering a passkey', () => {
  it('adds one and lists it back', async () => {
    const server = await build()
    await givenAccount('ada@example.org', 'a good long passphrase')
    const cookie = await signIn(server, 'ada@example.org', 'a good long passphrase')

    const { added } = await givenPasskey(server, cookie, 'Work laptop')

    expect(added.statusCode).toBe(201)
    expect(added.json().passkeys).toMatchObject([{ label: 'Work laptop', last_used_at: null }])

    const listed = await server.inject({ method: 'GET', url: '/api/me/passkeys', headers: { cookie } })
    expect(listed.json().passkeys).toHaveLength(1)
  })

  it('turns nobody away for having no role', async () => {
    // An applicant waiting on a decision, or somebody organising but not attending.
    // A role check on the way to your own credentials is a lockout with no way
    // round it, so the guard here is being signed in and nothing more.
    const server = await build()
    await givenAccount('ada@example.org', 'a good long passphrase')
    const cookie = await signIn(server, 'ada@example.org', 'a good long passphrase')

    const { added } = await givenPasskey(server, cookie)

    expect(added.statusCode).toBe(201)
  })

  it('refuses a challenge minted for somebody else', async () => {
    const server = await build()
    await givenAccount('ada@example.org', 'a good long passphrase')
    await givenAccount('bo@example.org', 'another long passphrase')
    const ada = await signIn(server, 'ada@example.org', 'a good long passphrase')
    const bo = await signIn(server, 'bo@example.org', 'another long passphrase')

    const started = await post(server, '/api/me/passkeys/challenge', bo)
    const added = await post(server, '/api/me/passkeys', ada, {
      label: 'Phone',
      response: makeAuthenticator().register(challengeFrom(started)),
    })

    expect(added.statusCode).toBe(400)
    // Spent all the same: a challenge one account has seen is not one another
    // may keep trying against.
    expect(await db().select().from(webauthnChallenge)).toHaveLength(0)
  })

  it('refuses a ceremony that happened on another origin', async () => {
    const server = await build()
    await givenAccount('ada@example.org', 'a good long passphrase')
    const cookie = await signIn(server, 'ada@example.org', 'a good long passphrase')

    const started = await post(server, '/api/me/passkeys/challenge', cookie)
    const added = await post(server, '/api/me/passkeys', cookie, {
      label: 'Phone',
      response: makeAuthenticator().register(challengeFrom(started), 'https://phishing.example.net'),
    })

    expect(added.statusCode).toBe(400)
  })

  it('refuses the same credential twice', async () => {
    const server = await build()
    await givenAccount('ada@example.org', 'a good long passphrase')
    const cookie = await signIn(server, 'ada@example.org', 'a good long passphrase')

    const { authenticator } = await givenPasskey(server, cookie)
    const again = await post(server, '/api/me/passkeys/challenge', cookie)
    const added = await post(server, '/api/me/passkeys', cookie, {
      label: 'Phone again',
      response: authenticator.register(challengeFrom(again)),
    })

    expect(added.statusCode).toBe(409)
  })

  it('turns away somebody who is not signed in', async () => {
    const server = await build()

    expect((await post(server, '/api/me/passkeys/challenge', '')).statusCode).toBe(401)
    expect((await post(server, '/api/me/passkeys', '', { label: 'x' })).statusCode).toBe(401)
    expect((await server.inject({ method: 'GET', url: '/api/me/passkeys' })).statusCode).toBe(401)
    expect(
      (await server.inject({ method: 'DELETE', url: `/api/me/passkeys/${randomUUID()}` })).statusCode,
    ).toBe(401)
  })
})

describe('signing in with a passkey', () => {
  it('answers with the viewer and a session cookie', async () => {
    const server = await build()
    const id = await givenAccount('ada@example.org', 'a good long passphrase')
    const cookie = await signIn(server, 'ada@example.org', 'a good long passphrase')
    const { authenticator } = await givenPasskey(server, cookie)

    const response = await loginWith(server, authenticator)

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ viewer: { account_id: id, name: 'Ada', roles: [] } })

    // The cookie is the session, so it has to work rather than merely be present.
    const me = await server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: cookieFrom(response) },
    })
    expect(me.json()).toMatchObject({ viewer: { account_id: id } })
  })

  it('records the counter and when it was last used', async () => {
    const server = await build()
    await givenAccount('ada@example.org', 'a good long passphrase')
    const cookie = await signIn(server, 'ada@example.org', 'a good long passphrase')
    const { authenticator } = await givenPasskey(server, cookie)

    clock = new Date('2026-08-06T09:30:00.000Z')
    await loginWith(server, authenticator, 7)

    const [row] = await db().select().from(passkey)
    expect(row?.counter).toBe(7)
    expect(row?.last_used_at).toBe('2026-08-06T09:30:00.000Z')
  })

  it('refuses an assertion whose signature has been tampered with', async () => {
    const server = await build()
    await givenAccount('ada@example.org', 'a good long passphrase')
    const cookie = await signIn(server, 'ada@example.org', 'a good long passphrase')
    const { authenticator } = await givenPasskey(server, cookie)

    const started = await post(server, '/api/auth/passkey/challenge', '')
    const assertion = authenticator.assert(challengeFrom(started))
    // The last byte, so the DER structure still parses and it is the signature
    // itself that fails to verify rather than the encoding around it.
    const bytes = isoBase64URL.toBuffer(assertion.response.signature)
    const tampered = Uint8Array.from(bytes, (byte, at) => (at === bytes.length - 1 ? byte ^ 0xff : byte))

    const response = await post(server, '/api/auth/passkey/login', '', {
      response: {
        ...assertion,
        response: { ...assertion.response, signature: isoBase64URL.fromBuffer(tampered) },
      },
    })

    expect(response.statusCode).toBe(401)
    // The slug as well as the status. A passkey login answers `invalid_credentials`
    // like the password login does, and `unauthenticated` — what a bare 401 maps to —
    // would be a different promise: the client documents this one as "did not
    // verify", not "you are signed out". #138's sweep changed it and every test here
    // stayed green, because they all asserted the status alone.
    expect(response.json()).toEqual({ error: 'invalid_credentials' })
  })

  it('refuses a challenge that has already been spent', async () => {
    const server = await build()
    await givenAccount('ada@example.org', 'a good long passphrase')
    const cookie = await signIn(server, 'ada@example.org', 'a good long passphrase')
    const { authenticator } = await givenPasskey(server, cookie)

    const started = await post(server, '/api/auth/passkey/challenge', '')
    const assertion = authenticator.assert(challengeFrom(started))
    const body = { response: assertion }

    expect((await post(server, '/api/auth/passkey/login', '', body)).statusCode).toBe(200)
    // The same bytes again. A challenge is one attempt, which is the whole reason
    // it is stored rather than signed into a cookie.
    expect((await post(server, '/api/auth/passkey/login', '', body)).statusCode).toBe(401)
  })

  it('refuses a challenge that has expired', async () => {
    const server = await build()
    await givenAccount('ada@example.org', 'a good long passphrase')
    const cookie = await signIn(server, 'ada@example.org', 'a good long passphrase')
    const { authenticator } = await givenPasskey(server, cookie)

    const started = await post(server, '/api/auth/passkey/challenge', '')
    const assertion = authenticator.assert(challengeFrom(started))

    clock = new Date(NOW.getTime() + 6 * 60 * 1000)
    const response = await post(server, '/api/auth/passkey/login', '', { response: assertion })

    expect(response.statusCode).toBe(401)
  })

  it('refuses a registration challenge', async () => {
    // The two ceremonies mint challenges into the same table, and only the account
    // column tells them apart. A login carrying one that was minted for a
    // registration is somebody reaching for the wrong half.
    const server = await build()
    await givenAccount('ada@example.org', 'a good long passphrase')
    const cookie = await signIn(server, 'ada@example.org', 'a good long passphrase')
    const { authenticator } = await givenPasskey(server, cookie)

    const started = await post(server, '/api/me/passkeys/challenge', cookie)
    const response = await post(server, '/api/auth/passkey/login', '', {
      response: authenticator.assert(challengeFrom(started)),
    })

    expect(response.statusCode).toBe(401)
  })

  it('sweeps the challenges nobody came back for', async () => {
    // Nothing else deletes them. Somebody who starts a ceremony and walks away
    // leaves a row behind, and the next ceremony is the only thing in a position
    // to notice — which is why there is no scheduled job.
    const server = await build()
    await post(server, '/api/auth/passkey/challenge', '')

    clock = new Date(NOW.getTime() + 6 * 60 * 1000)
    await post(server, '/api/auth/passkey/challenge', '')

    expect(await db().select().from(webauthnChallenge)).toHaveLength(1)
  })

  it('refuses a credential nobody has registered', async () => {
    const server = await build()
    await givenAccount('ada@example.org', 'a good long passphrase')

    const response = await loginWith(server, makeAuthenticator())

    expect(response.statusCode).toBe(401)
  })
})

describe('removing a passkey', () => {
  it('leaves the rest alone', async () => {
    const server = await build()
    await givenAccount('ada@example.org', 'a good long passphrase')
    const cookie = await signIn(server, 'ada@example.org', 'a good long passphrase')
    await givenPasskey(server, cookie, 'Phone')
    const { added } = await givenPasskey(server, cookie, 'Laptop')

    const laptop = added.json().passkeys.find((row: { label: string }) => row.label === 'Laptop')
    const response = await server.inject({
      method: 'DELETE',
      url: `/api/me/passkeys/${laptop.id}`,
      headers: { cookie },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().passkeys).toMatchObject([{ label: 'Phone' }])
  })

  it('lists them oldest first, whatever order the rows went in', async () => {
    // #240. Without an `ORDER BY` the answer is whatever the query plan produced —
    // insertion order, here — and the list re-renders from this response after every
    // add and remove, so rows appeared to move for no reason anybody could see.
    //
    // The newer one is added *first*, so the two orders disagree. Added in the
    // obvious order they agree, and this would pass against no `ORDER BY` at all.
    const server = await build()
    await givenAccount('ada@example.org', 'a good long passphrase')
    const cookie = await signIn(server, 'ada@example.org', 'a good long passphrase')

    clock = new Date(NOW.getTime() + 60 * 1000)
    await givenPasskey(server, cookie, 'Newer')
    clock = NOW
    const { added } = await givenPasskey(server, cookie, 'Older')

    expect(added.json().passkeys.map((row: { label: string }) => row.label)).toEqual(['Older', 'Newer'])
  })

  it('lets a passkey-only account remove one while it has a spare', async () => {
    // The other arm of the guard (#239): the refusal below is about the *last* way
    // in, not about having no password. Removing a second phone is ordinary.
    const server = await build()
    const id = await givenAccount('ada@example.org', 'a good long passphrase')
    const cookie = await signIn(server, 'ada@example.org', 'a good long passphrase')
    await givenPasskey(server, cookie, 'Phone')
    const { added } = await givenPasskey(server, cookie, 'Laptop')
    await db().update(account).set({ password_hash: null }).where(eq(account.id, id))

    const laptop = added.json().passkeys.find((row: { label: string }) => row.label === 'Laptop')
    const response = await server.inject({
      method: 'DELETE',
      url: `/api/me/passkeys/${laptop.id}`,
      headers: { cookie },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().passkeys).toMatchObject([{ label: 'Phone' }])
  })

  it('refuses the last one when there is no password to fall back on', async () => {
    const server = await build()
    const id = await givenAccount('ada@example.org', 'a good long passphrase')
    const cookie = await signIn(server, 'ada@example.org', 'a good long passphrase')
    const { added } = await givenPasskey(server, cookie)
    const only = added.json().passkeys[0].id

    // Passkey-only from here: removing this would leave no way in at all. Nothing in
    // the app lets them back — the reset is an admin's, from the accounts page.
    await db().update(account).set({ password_hash: null }).where(eq(account.id, id))

    const response = await server.inject({
      method: 'DELETE',
      url: `/api/me/passkeys/${only}`,
      headers: { cookie },
    })

    expect(response.statusCode).toBe(409)
    expect(await db().select().from(passkey)).toHaveLength(1)
  })

  it('allows the last one while a password is set', async () => {
    // The passing sibling of the refusal above, and the case that matters: a
    // member who decides they would rather not keep a passkey at all.
    const server = await build()
    await givenAccount('ada@example.org', 'a good long passphrase')
    const cookie = await signIn(server, 'ada@example.org', 'a good long passphrase')
    const { added } = await givenPasskey(server, cookie)

    const response = await server.inject({
      method: 'DELETE',
      url: `/api/me/passkeys/${added.json().passkeys[0].id}`,
      headers: { cookie },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().passkeys).toEqual([])
  })

  it('refuses to remove somebody else’s', async () => {
    const server = await build()
    await givenAccount('ada@example.org', 'a good long passphrase')
    await givenAccount('bo@example.org', 'another long passphrase')
    const ada = await signIn(server, 'ada@example.org', 'a good long passphrase')
    const bo = await signIn(server, 'bo@example.org', 'another long passphrase')
    const { added } = await givenPasskey(server, ada)

    const response = await server.inject({
      method: 'DELETE',
      url: `/api/me/passkeys/${added.json().passkeys[0].id}`,
      headers: { cookie: bo },
    })

    // 404 rather than 403: whether a given id exists is not something one member
    // has any business learning about another's devices.
    expect(response.statusCode).toBe(404)
    expect(await db().select().from(passkey)).toHaveLength(1)
  })
})

describe('which domain a passkey is bound to', () => {
  it('takes the configured origin over the one the request claims', async () => {
    // A relaying proxy sends its own `Origin`. With `PUBLIC_ORIGIN` set, the
    // ceremony it relays is refused rather than registered against its domain.
    const server = await build({ PUBLIC_ORIGIN: 'https://burn.example.org' })
    await givenAccount('ada@example.org', 'a good long passphrase')
    const cookie = await signIn(server, 'ada@example.org', 'a good long passphrase')

    const started = await server.inject({
      method: 'POST',
      url: '/api/me/passkeys/challenge',
      headers: { cookie, origin: 'https://phishing.example.net' },
    })

    expect(started.json().options.rp.id).toBe(RP_ID)

    const added = await server.inject({
      method: 'POST',
      url: '/api/me/passkeys',
      headers: { cookie, origin: 'https://phishing.example.net' },
      payload: {
        label: 'Phone',
        response: makeAuthenticator().register(challengeFrom(started), 'https://phishing.example.net'),
      },
    })

    expect(added.statusCode).toBe(400)
  })

  it('has nothing to bind to when neither is available', async () => {
    const server = await build()
    await givenAccount('ada@example.org', 'a good long passphrase')
    const cookie = await signIn(server, 'ada@example.org', 'a good long passphrase')

    const started = await server.inject({
      method: 'POST',
      url: '/api/me/passkeys/challenge',
      headers: { cookie },
    })

    expect(started.statusCode).toBe(400)
  })
})
