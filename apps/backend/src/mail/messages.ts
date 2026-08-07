import type { Message } from './mail.ts'

/**
 * Every message this app sends, written out in one place (#30).
 *
 * Pure — a subject and a body from their parts — so the wording is testable without
 * a mail server, and so nothing that composes a message has to reach for a database.
 *
 * All of it is plain text. Nothing here is worth a second HTML rendering to keep in
 * step with the first, and a text part is what every client can show.
 */

/** Where somebody can turn the second channel off, on every message that is one. */
const OFF_SWITCH = 'You can turn these emails off under Your details → Notifications.'

/**
 * Absolute, because an email is read outside the app.
 *
 * The origin is the one the request arrived on, or `PUBLIC_ORIGIN` where an operator
 * named one — the same pair the share card uses, and for the same reason: this app
 * has no notion of its own address. Without one there is no link worth writing, so
 * the caller passes `undefined` and the message says the path in words instead.
 */
export const absolute = (origin: string | undefined, path: string): string | undefined =>
  origin === undefined ? undefined : `${origin}${path}`

/**
 * The invite, which is the one message somebody gets before they have an account.
 *
 * The link is the whole of it: the token exists in this message and in the approval's
 * response, and nowhere else — only its digest is stored. Naming the expiry is not
 * decoration, since a link found in an inbox six weeks later fails with nothing to
 * say why.
 */
export const inviteMessage = ({
  installation,
  to,
  name,
  link,
  expires,
}: {
  installation: string
  to: string
  name: string
  link: string
  /** The date the link stops working, `YYYY-MM-DD`. */
  expires: string
}): Message => ({
  to,
  subject: `You are invited to ${installation}`,
  // Wrapped short, and the link alone on its own line. A plain-text part goes out
  // quoted-printable, which soft-wraps anything past 76 columns — harmless once a
  // client decodes it, and not worth risking in the middle of the one line that has
  // to survive being clicked.
  text: [
    `Hello ${name},`,
    '',
    'Your application has been accepted. Follow this link to set up',
    `your account at ${installation}:`,
    '',
    link,
    '',
    `The link works once, and until ${expires}. If it has expired by`,
    'then, ask whoever invited you for a new one.',
    '',
    installation,
  ].join('\n'),
})

/**
 * One thing that happened, for somebody who asked to hear about it by email.
 *
 * The same sentence the bell shows, because it is the same notification — a second
 * wording per category would be one more thing per category to keep in step, and the bell's is
 * already written to stand alone.
 */
export const notificationMessage = ({
  installation,
  to,
  body,
  link,
}: {
  installation: string
  to: string
  body: string
  /** Absolute, or nothing when this app does not know its own address. */
  link: string | undefined
}): Message => ({
  to,
  subject: `${installation}: ${body}`,
  text: [body, ...(link === undefined ? [] : ['', link]), '', '--', OFF_SWITCH].join('\n'),
})

/** Proof the settings work, sent to the admin who just typed them in. */
export const testMessage = ({ installation, to }: { installation: string; to: string }): Message => ({
  to,
  subject: `${installation}: mail is working`,
  text: [
    'This is a test message from your own installation.',
    '',
    'If you are reading it, the SMTP settings under Organise → Settings are right,',
    'and invites and notifications can go out from here.',
    '',
    installation,
  ].join('\n'),
})
