import type { Viewer } from '@sage-burner/shared'
import type { FastifyRequest } from 'fastify'

import { eq } from 'drizzle-orm'

import type { Database } from '../db/index.ts'
import type { Sessions } from './session.ts'

import { account, accountAvatar, accountRole } from '../db/schema.ts'

type Requesting = Pick<FastifyRequest, 'headers'>

export const SESSION_COOKIE = 'sage_session'

export const readSessionCookie = (header: string | undefined): string | undefined => {
  if (header === undefined) return undefined

  const present = header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${SESSION_COOKIE}=`))

  if (present.length !== 1) return undefined

  const value = present[0]?.slice(SESSION_COOKIE.length + 1)
  return value === undefined || value === '' ? undefined : value
}

const resolved = new WeakMap<Requesting, Viewer | undefined>()

export const viewerFor = async (
  request: Requesting,
  deps: { db: Database; sessions: Sessions },
): Promise<Viewer | undefined> => {
  if (resolved.has(request)) return resolved.get(request)

  const viewer = await readViewer(request, deps)
  resolved.set(request, viewer)

  return viewer
}

const readViewer = async (
  request: Requesting,
  deps: { db: Database; sessions: Sessions },
): Promise<Viewer | undefined> => {
  const token = readSessionCookie(request.headers.cookie)
  if (token === undefined) return undefined

  const payload = deps.sessions.read(token)
  if (payload === undefined) return undefined

  return viewerOf(deps.db, payload.account_id)
}

export const viewerOf = async (db: Database, accountId: string): Promise<Viewer | undefined> => {
  const rows = await db
    .select({
      id: account.id,
      name: account.name,
      avatar: accountAvatar.updated_at,
      role: accountRole.role,
    })
    .from(account)
    .leftJoin(accountRole, eq(accountRole.account_id, account.id))
    .leftJoin(accountAvatar, eq(accountAvatar.account_id, account.id))
    .where(eq(account.id, accountId))

  const first = rows[0]
  if (first === undefined) return undefined

  return {
    account_id: first.id,
    name: first.name,
    avatar: first.avatar,
    roles: rows.map((row) => row.role).filter((role) => role !== null),
  }
}
