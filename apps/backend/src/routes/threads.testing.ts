import type { Thread } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

export const cardOf = async (server: FastifyInstance, cookie: string, threadId: string): Promise<Thread> =>
  (await server.inject({ method: 'GET', url: `/api/threads/${threadId}`, headers: { cookie } })).json().thread

export const bell = async (
  server: FastifyInstance,
  cookie: string,
): Promise<{ category: string; body: string; link: string | null }[]> =>
  (await server.inject({ method: 'GET', url: '/api/me/notifications', headers: { cookie } })).json()
    .notifications

export const setOn = (server: FastifyInstance, cookie: string, on: string[]) =>
  server.inject({
    method: 'PUT',
    url: '/api/me/notification-settings',
    headers: { cookie },
    payload: { on, email: [], digest: 'daily' },
  })
