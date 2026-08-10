import nodemailer from 'nodemailer'

import type { Send } from './mail.ts'

const TIMEOUT_MS = 15_000

export const sendWithSmtp: Send = async (transport, message) => {
  const mailer = nodemailer.createTransport({
    host: transport.host,
    port: transport.port,
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
    mailer.close()
  }
}
