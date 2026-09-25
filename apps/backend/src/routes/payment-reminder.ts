import type { PaymentReminderResponse } from '@sage-burner/shared'
import type { FastifyInstance } from 'fastify'

import { apiRoutes, membersPage, paymentReminderSchema } from '@sage-burner/shared'
import { and, eq, ne } from 'drizzle-orm'

import type { GuardDeps } from '../auth/guards.ts'
import type { Config } from '../config.ts'
import type { Database } from '../db/index.ts'
import type { Notifier } from '../push/notify.ts'

import { viewerFor } from '../auth/viewer.ts'
import { attendance } from '../db/schema.ts'
import { bodyOf, noStore, sendError } from '../http.ts'
import { absolute, paymentReminderMessage } from '../mail/messages.ts'
import { oneBatch } from '../push/notify.ts'
import { originOf } from '../shell.ts'
import { openEventNow } from './events.ts'

export interface PaymentReminderDeps extends GuardDeps {
  config: Config
  now: () => Date
  notify: Notifier
}

const unpaidOn = async (db: Database, eventId: string): Promise<string[]> => {
  const rows = await db
    .select({ account_id: attendance.account_id })
    .from(attendance)
    .where(and(eq(attendance.event_id, eventId), ne(attendance.payment_status, 'paid')))

  return rows.map((row) => row.account_id)
}

export const registerPaymentReminderRoutes = (
  app: FastifyInstance,
  { db, sessions, config, now, notify }: PaymentReminderDeps,
) => {
  app.post<{ Params: { eventId: string } }>(apiRoutes.remindUnpaid.fastify, async (request, reply) => {
    void noStore(reply)

    const body = bodyOf(paymentReminderSchema, request)
    if (body === undefined) return sendError(reply, 400)

    const open = await openEventNow(db, now, request.params.eventId)
    if (open === undefined) return sendError(reply, 404)

    const sender = (await viewerFor(request, { db, sessions }))?.account_id
    const audience = (await unpaidOn(db, open.id)).filter((accountId) => accountId !== sender)
    const link = membersPage(open.id)
    const origin = originOf(request, config)
    const told = oneBatch({
      category: 'payment_reminder',
      body: body.subject,
      link,
      letter: ({ installation, to, name }) =>
        paymentReminderMessage({
          installation,
          to,
          name,
          subject: body.subject,
          body: body.body,
          link: absolute(origin, link),
        }),
    })

    for (const accountId of audience) {
      await notify(accountId, told).catch((failure: unknown) => {
        app.log.error({ err: failure, account_id: accountId }, 'reminding an attendee to pay')
      })
    }

    return { told: audience.length } satisfies PaymentReminderResponse
  })
}
