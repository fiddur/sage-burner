import type { MeResponse, PasskeysResponse } from '@sage-burner/shared'
import type { FastifyInstance, FastifyRequest } from 'fastify'

import { apiRoutes, errorResponse, passkeyLoginSchema, passkeyRegistrationSchema } from '@sage-burner/shared'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { decodeClientDataJSON, isoBase64URL } from '@simplewebauthn/server/helpers'
import { and, asc, eq, gt, lt, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { Sessions } from '../auth/session.ts'
import type { Config } from '../config.ts'
import type { Database } from '../db/index.ts'

import { viewerFor, viewerOf } from '../auth/viewer.ts'
import { knownTransports, relyingParty } from '../auth/webauthn.ts'
import { isUniqueViolation } from '../db/errors.ts'
import { account, INSTALLATION_ID, installation, passkey, webauthnChallenge } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { cookieHeader } from './auth.ts'

export interface PasskeyDeps {
  db: Database
  config: Config
  sessions: Sessions
  now?: () => Date
}

/**
 * How long a member has to finish a ceremony.
 *
 * Longer than the 60 seconds the browser gives the authenticator, because the
 * two are timing different things: the browser's clock runs while the dialog is
 * open, this one runs from asking for the challenge. Someone who has to go and
 * find their security key spends the difference.
 */
const CHALLENGE_TTL_SECONDS = 300

/**
 * Passkeys, for accounts that have one — alongside the password, never instead of
 * it (#9).
 *
 * Outside `/api/admin` and outside `requireApproved` both: the guard here is
 * being signed in at all. An account with no role yet — an applicant waiting,
 * somebody organising but not attending — still has to be able to add a passkey and get
 * back in with it, and a role check on the way to your own credentials would be a
 * lockout with no way round it.
 *
 * Login is usernameless. `residentKey: 'required'` at registration means the
 * credential is discoverable, so `/api/auth/passkey/challenge` can offer every
 * passkey the browser holds for this domain without being told an address first —
 * which is also why no email is asked for, and why nothing here can be used to
 * find out whether an address has an account.
 */
export const registerPasskeyRoutes = (
  app: FastifyInstance,
  { db, config, sessions, now = () => new Date() }: PasskeyDeps,
) => {
  const partyFor = (request: FastifyRequest) => relyingParty(config.public_origin, request.headers.origin)

  const mintChallenge = async (challenge: string, accountId: string | null) => {
    const stamp = now()
    // Swept here rather than on a schedule: a ceremony is the only thing that makes
    // these, so it is also the only thing that can leave them behind.
    await db.delete(webauthnChallenge).where(lt(webauthnChallenge.expires_at, stamp.toISOString()))
    await db.insert(webauthnChallenge).values({
      challenge,
      account_id: accountId,
      expires_at: new Date(stamp.getTime() + CHALLENGE_TTL_SECONDS * 1000).toISOString(),
    })
  }

  /**
   * Spend a challenge, or answer that there was none to spend.
   *
   * The delete is the check: `where` matches only an unexpired row, and
   * `returning` says whether it was there — so a second response carrying the same
   * challenge finds nothing, which is the replay this exists to refuse.
   */
  const spendChallenge = async (challenge: string) => {
    const [row] = await db
      .delete(webauthnChallenge)
      .where(
        and(
          eq(webauthnChallenge.challenge, challenge),
          gt(webauthnChallenge.expires_at, now().toISOString()),
        ),
      )
      .returning()

    return row
  }

  const challengeOf = (clientDataJSON: string): string | undefined => {
    try {
      return decodeClientDataJSON(clientDataJSON).challenge
    } catch {
      return undefined
    }
  }

  const listFor = async (accountId: string): Promise<PasskeysResponse> => {
    const rows = await db
      .select({
        id: passkey.id,
        label: passkey.label,
        created_at: passkey.created_at,
        last_used_at: passkey.last_used_at,
      })
      .from(passkey)
      .where(eq(passkey.account_id, accountId))
      // Oldest first, so a newly added one lands at the bottom where the member was
      // just looking (#240). Without it the order is whatever the query plan
      // produced, and the list re-renders from this after every add and remove — so
      // rows appeared to jump for no reason anybody could see.
      .orderBy(asc(passkey.created_at), asc(passkey.id))

    return { passkeys: rows }
  }

  app.post(apiRoutes.startPasskeyRegistration.fastify, async (request, reply) => {
    void noStore(reply)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return sendError(reply, 401)

    const party = partyFor(request)
    if (party === undefined) return sendError(reply, 400)

    const [holder] = await db
      .select({ email: account.email })
      .from(account)
      .where(eq(account.id, viewer.account_id))
      .limit(1)

    if (holder === undefined) return sendError(reply, 401)

    const [named] = await db
      .select({ title: installation.title })
      .from(installation)
      .where(eq(installation.id, INSTALLATION_ID))
      .limit(1)

    const already = await db
      .select({ credential_id: passkey.credential_id, transports: passkey.transports })
      .from(passkey)
      .where(eq(passkey.account_id, viewer.account_id))

    const options = await generateRegistrationOptions({
      rpName: named?.title ?? 'Sage Burner',
      rpID: party.id,
      userName: holder.email,
      userDisplayName: viewer.name ?? holder.email,
      // The account id, so the user handle the authenticator stores means
      // something here. A UUID rather than the address, which is the identity
      // somebody logs in with and has no business sitting in a credential the
      // member may hand to a shared device.
      userID: new TextEncoder().encode(viewer.account_id),
      attestationType: 'none',
      // So the browser says "you already have one of these" rather than letting a
      // member register the same device twice and wonder which is which.
      excludeCredentials: already.map((row) => ({
        id: row.credential_id,
        ...(row.transports === null ? {} : { transports: knownTransports(row.transports.split(',')) }),
      })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    })

    await mintChallenge(options.challenge, viewer.account_id)

    return reply.code(200).send({ options })
  })

  app.post(apiRoutes.addPasskey.fastify, async (request, reply) => {
    void noStore(reply)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return sendError(reply, 401)

    const body = bodyOf(passkeyRegistrationSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const party = partyFor(request)
    if (party === undefined) return sendError(reply, 400)

    const challenge = challengeOf(body.response.response.clientDataJSON)
    if (challenge === undefined) return sendError(reply, 400)

    // Spent before it is verified, so a rejected response cannot be retried with a
    // second guess at the same challenge — and the account check is here rather
    // than in the query so that another member's challenge is spent too.
    const spent = await spendChallenge(challenge)
    if (spent === undefined || spent.account_id !== viewer.account_id) {
      return sendError(reply, 400)
    }

    const response = {
      ...body.response,
      response: {
        ...body.response.response,
        transports: knownTransports(body.response.response.transports),
      },
    }

    let verified
    try {
      verified = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: party.origin,
        expectedRPID: party.id,
      })
    } catch (failure) {
      // The library throws for a response it can read but does not accept, and
      // returns `verified: false` for one it accepts as unverified. Both are the
      // same thing to the member: that did not work, try again.
      request.log.info({ err: failure }, 'passkey registration rejected')
      return sendError(reply, 400)
    }

    if (!verified.verified) return sendError(reply, 400)

    const { credential } = verified.registrationInfo

    try {
      await db.insert(passkey).values({
        id: randomUUID(),
        account_id: viewer.account_id,
        credential_id: credential.id,
        public_key: isoBase64URL.fromBuffer(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports?.join(',') ?? null,
        label: body.label,
        created_at: now().toISOString(),
      })
    } catch (failure) {
      // `excludeCredentials` asks the browser to refuse this, and a browser that
      // does not is not a reason to answer 500.
      if (isUniqueViolation(failure)) return sendError(reply, 409)
      throw failure
    }

    return reply.code(201).send(await listFor(viewer.account_id))
  })

  app.get(apiRoutes.getMyPasskeys.fastify, async (request, reply) => {
    void noStore(reply)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return sendError(reply, 401)

    return reply.code(200).send(await listFor(viewer.account_id))
  })

  app.delete<{ Params: { id: string } }>(apiRoutes.removePasskey.fastify, async (request, reply) => {
    void noStore(reply)

    const viewer = await viewerFor(request, { db, sessions })
    if (viewer === undefined) return sendError(reply, 401)

    const [mine] = await db
      .select({ id: passkey.id })
      .from(passkey)
      .where(and(eq(passkey.id, request.params.id), eq(passkey.account_id, viewer.account_id)))
      .limit(1)

    // Somebody else's is a 404 rather than a 403: whether a given id exists is not
    // something a member has any business learning about another's devices.
    if (mine === undefined) return sendError(reply, 404)

    /**
     * The one refusal in this file that is not about authentication: removing the
     * last passkey from an account with no password locks its owner out for good.
     * Nothing in the app lets them back in — the reset is an admin's, from the
     * accounts page, so it needs somebody else and a shell or a signed-in browser.
     *
     * **In the statement's own `WHERE`, not in a read before it** (#239). Counting
     * the survivors and reading the password in separate statements let two removals
     * from two tabs each see two passkeys, both pass, and together leave the account
     * with no way in at all — exactly the lockout the 409 exists to prevent. Here
     * the count is taken by the same statement that deletes, so the second one
     * matches nothing.
     *
     * This is the one place in the app that engineers for a race, against the rule
     * the rest of it follows. It is not that the window is realistic — it needs one
     * person removing their own two passkeys in the same second — but that the
     * consequence is permanent and there is no way back through the app.
     *
     * Untestable through `inject`, which serialises requests. What the suite pins is
     * the refusal itself, and that an account with a password or a spare key is not
     * refused.
     */
    const canLoseOne = sql`(
      exists (
        select 1 from ${account}
        where ${account.id} = ${viewer.account_id} and ${account.password_hash} is not null
      )
      or (select count(*) from ${passkey} where ${passkey.account_id} = ${viewer.account_id}) > 1
    )`

    const removed = await db
      .delete(passkey)
      .where(and(eq(passkey.id, mine.id), eq(passkey.account_id, viewer.account_id), canLoseOne))
      .returning({ id: passkey.id })

    // The row was there a moment ago and this is the owner's own request, so the
    // only thing that matches nothing is the guard.
    if (removed.length === 0) return sendError(reply, 409)

    return reply.code(200).send(await listFor(viewer.account_id))
  })

  app.post(apiRoutes.startPasskeyLogin.fastify, async (request, reply) => {
    void noStore(reply)

    const party = partyFor(request)
    if (party === undefined) return sendError(reply, 400)

    // No `allowCredentials`, which is what makes this usernameless: the browser
    // offers whatever discoverable credentials it holds for this domain. Naming
    // them would need an address first, and answering "which passkeys does this
    // address have" is an account enumeration oracle.
    const options = await generateAuthenticationOptions({ rpID: party.id, userVerification: 'required' })

    await mintChallenge(options.challenge, null)

    return reply.code(200).send({ options })
  })

  app.post(apiRoutes.finishPasskeyLogin.fastify, async (request, reply) => {
    void noStore(reply)

    const parsed = passkeyLoginSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(401).send(errorResponse('invalid_credentials'))

    const party = partyFor(request)
    if (party === undefined) return reply.code(401).send(errorResponse('invalid_credentials'))

    const challenge = challengeOf(parsed.data.response.response.clientDataJSON)
    if (challenge === undefined) return reply.code(401).send(errorResponse('invalid_credentials'))

    const spent = await spendChallenge(challenge)
    // A registration challenge is not a login challenge. The ceremony type in
    // `clientDataJSON` differs too and the library checks it, so this is the
    // second of two — but it is the one that is ours to make.
    if (spent === undefined || spent.account_id !== null) {
      return reply.code(401).send(errorResponse('invalid_credentials'))
    }

    const [found] = await db
      .select()
      .from(passkey)
      .where(eq(passkey.credential_id, parsed.data.response.id))
      .limit(1)

    if (found === undefined) return reply.code(401).send(errorResponse('invalid_credentials'))

    let verified
    try {
      verified = await verifyAuthenticationResponse({
        response: parsed.data.response,
        expectedChallenge: challenge,
        expectedOrigin: party.origin,
        expectedRPID: party.id,
        credential: {
          id: found.credential_id,
          publicKey: isoBase64URL.toBuffer(found.public_key),
          counter: found.counter,
          ...(found.transports === null ? {} : { transports: knownTransports(found.transports.split(',')) }),
        },
      })
    } catch (failure) {
      request.log.info({ err: failure }, 'passkey login rejected')
      return reply.code(401).send(errorResponse('invalid_credentials'))
    }

    if (!verified.verified) return reply.code(401).send(errorResponse('invalid_credentials'))

    const viewer = await viewerOf(db, found.account_id)
    if (viewer === undefined) return reply.code(401).send(errorResponse('invalid_credentials'))

    await db
      .update(passkey)
      .set({ counter: verified.authenticationInfo.newCounter, last_used_at: now().toISOString() })
      .where(eq(passkey.id, found.id))

    // Same order as the password login, for the same reason: nothing is issued
    // until every query that can fail has succeeded, or a failure answers 500 with
    // a valid session cookie already attached.
    void reply.header(
      'set-cookie',
      cookieHeader(sessions.issue(found.account_id), config, config.session_ttl_seconds),
    )

    return reply.code(200).send({ viewer } satisfies MeResponse)
  })
}
