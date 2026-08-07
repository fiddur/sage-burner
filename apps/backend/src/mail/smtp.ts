/**
 * The one place that talks to a mail server.
 *
 * Kept apart from `mail.ts` so everything else about email is testable: sending needs
 * a real SMTP server to accept a connection, so the suite injects a spy and this is
 * what production passes instead. Exactly the split `web-push.ts` has.
 *
 * `nodemailer` rather than hand-rolled SMTP. The protocol itself is a handful of
 * lines, but the parts around it are not — STARTTLS negotiation, which AUTH mechanism
 * a server offers, dot-stuffing, header folding, and MIME encoding of any name or
 * subject that is not ASCII. A gathering called "Sagegården" would find that last one
 * on the first message.
 */

import nodemailer from 'nodemailer'

import type { Send } from './mail.ts'

/**
 * How long to wait on a server that is not answering.
 *
 * Bounded because a caller is waiting: an admin pressing Test, or a route that has
 * already written its row and is posting a copy. `nodemailer`'s own defaults are
 * minutes, which for a mistyped host means a request that appears to hang.
 */
const TIMEOUT_MS = 15_000

export const sendWithSmtp: Send = async (transport, message) => {
  const mailer = nodemailer.createTransport({
    host: transport.host,
    port: transport.port,
    // `false` is not "no TLS": the client still upgrades with STARTTLS where the
    // server offers it, which is what 587 and 25 do. This flag is only whether the
    // socket is TLS from the first byte, which is 465.
    secure: transport.secure,
    ...(transport.username === '' ? {} : { auth: { user: transport.username, pass: transport.password } }),
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  })

  try {
    await mailer.sendMail({
      from: transport.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    })
  } finally {
    // One connection per message, closed either way. This app sends a handful of
    // messages a week; a pool would be a resource held open for months to save a
    // handshake nobody is waiting on.
    mailer.close()
  }
}
