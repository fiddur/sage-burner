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
import { account, installation, INSTALLATION_ID, passkey, webauthnChallenge } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { cookieHeader } from './auth.ts'

export interface PasskeyDeps {
  db: Database
  config: Config
  sessions: Sessions
  now: () => Date
}

const CHALLENGE_TTL_SECONDS = 300

export const registerPasskeyRoutes = (app: FastifyInstance, { db, config, sessions, now }: PasskeyDeps) => {
  const partyFor = (request: FastifyRequest) => relyingParty(config.public_origin, request.headers.origin)

  const mintChallenge = async (challenge: string, accountId: string | null) => {
    const stamp = now()
    await db.delete(webauthnChallenge).where(lt(webauthnChallenge.expires_at, stamp.toISOString()))
    await db.insert(webauthnChallenge).values({
      challenge,
      account_id: accountId,
      expires_at: new Date(stamp.getTime() + CHALLENGE_TTL_SECONDS * 1000).toISOString(),
    })
  }

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
      userID: new TextEncoder().encode(viewer.account_id),
      attestationType: 'none',
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

    if (mine === undefined) return sendError(reply, 404)

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

    if (removed.length === 0) return sendError(reply, 409)

    return reply.code(200).send(await listFor(viewer.account_id))
  })

  app.post(apiRoutes.startPasskeyLogin.fastify, async (request, reply) => {
    void noStore(reply)

    const party = partyFor(request)
    if (party === undefined) return sendError(reply, 400)

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

    void reply.header(
      'set-cookie',
      cookieHeader(sessions.issue(found.account_id), config, config.session_ttl_seconds),
    )

    return reply.code(200).send({ viewer } satisfies MeResponse)
  })
}
