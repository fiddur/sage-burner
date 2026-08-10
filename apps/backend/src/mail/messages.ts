import type { Message } from './mail.ts'

const OFF_SWITCH = 'You can turn these emails off under Your details → Notifications.'

export const absolute = (origin: string | undefined, path: string): string | undefined =>
  origin === undefined ? undefined : `${origin}${path}`

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
  expires: string
}): Message => ({
  to,
  subject: `You are invited to ${installation}`,
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

export const notificationMessage = ({
  installation,
  to,
  body,
  link,
}: {
  installation: string
  to: string
  body: string
  link: string | undefined
}): Message => ({
  to,
  subject: `${installation}: ${body}`,
  text: [body, ...(link === undefined ? [] : ['', link]), '', '--', OFF_SWITCH].join('\n'),
})

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
