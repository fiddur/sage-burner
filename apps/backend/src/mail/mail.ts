import { eq } from 'drizzle-orm'

import type { Database } from '../db/index.ts'

import { INSTALLATION_ID, mailSetting } from '../db/schema.ts'

/**
 * Email, which this installation may or may not have (#30).
 *
 * Same shape as push: the decisions are here and testable, and the one module that
 * talks to a server is `smtp.ts`, which production passes in. Nothing here is
 * required — an installation with no `mail_setting` row simply posts nothing, and
 * every caller treats that as an ordinary answer rather than a failure.
 */

/** One message, which is as much as this app ever needs to send. */
export interface Message {
  to: string
  subject: string
  /**
   * Plain text, and only plain text.
   *
   * Nothing sent from here is worth a second rendering to keep in step with the
   * first, and a text part is what every client can show. It also means no address
   * or member-written line is ever interpolated into markup on the way out.
   */
  text: string
}

/** What a server needs to be told, with the from address already formatted. */
export interface Transport {
  host: string
  port: number
  secure: boolean
  username: string
  password: string
  from: string
}

/**
 * One send attempt, injected so nothing in the suite reaches a mail server.
 *
 * Allowed to reject: the reason an SMTP server gives — bad credentials, a relay that
 * refuses the sender, nothing listening on the port — is the whole content of a
 * failure here, and `post` is what turns it into an answer.
 */
export type Send = (transport: Transport, message: Message) => Promise<void>

export interface MailDeps {
  db: Database
  send: Send
}

/** Whether it went, and what stopped it if it did not. */
export interface Posted {
  sent: boolean
  reason: string | null
}

/** Nobody has set an SMTP server up, which is the ordinary state. */
export const NOT_CONFIGURED = 'No mail server has been set up.'

export const mailSettingsFor = async (db: Database) => {
  const [row] = await db.select().from(mailSetting).where(eq(mailSetting.id, INSTALLATION_ID)).limit(1)

  return row
}

/**
 * The `From:` header, with the name quoted rather than escaped away.
 *
 * A display name containing a comma, a quote or a backslash is a header injection
 * waiting to happen, and an installation calls itself whatever it likes. Quoted-string
 * form per RFC 5322 handles all three; anything that could end the header — a newline,
 * a carriage return — is removed outright, since there is no encoding of it that
 * belongs in a name.
 */
export const fromAddress = (name: string, email: string): string => {
  const clean = name.replaceAll(/[\r\n]+/gu, ' ').trim()
  if (clean === '') return email

  return `"${clean.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}" <${email}>`
}

export const transportFor = (row: {
  host: string
  port: number
  secure: boolean
  username: string
  password: string
  from_email: string
  from_name: string
}): Transport => ({
  host: row.host,
  port: row.port,
  secure: row.secure,
  username: row.username,
  password: row.password,
  from: fromAddress(row.from_name, row.from_email),
})

/**
 * What to tell an admin about a failure.
 *
 * The server's own words, because they name the problem and this app cannot: "535
 * authentication failed" and "connect ECONNREFUSED" want completely different fixes,
 * and "could not send" sends somebody looking at the wrong one.
 */
export const reasonFor = (failure: unknown): string =>
  failure instanceof Error && failure.message !== '' ? failure.message : 'The mail server refused it.'

/**
 * Post one message, or say why not. **Never throws.**
 *
 * Every caller is doing something else — approving an application, handing somebody a
 * role — and none of them may fail because a mail server was down. That is the rule
 * push already follows, and it matters more here: the thing being notified about is
 * written before this runs.
 */
export const post = async ({ db, send }: MailDeps, message: Message): Promise<Posted> => {
  const settings = await mailSettingsFor(db)
  if (settings === undefined) return { sent: false, reason: NOT_CONFIGURED }

  try {
    await send(transportFor(settings), message)

    return { sent: true, reason: null }
  } catch (failure) {
    return { sent: false, reason: reasonFor(failure) }
  }
}
