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

export const decisionMessage = ({
  installation,
  to,
  name,
  approved,
  link,
}: {
  installation: string
  to: string
  name: string
  approved: boolean
  link: string
}): Message => ({
  to,
  subject: approved ? `You are in at ${installation}` : `About your application to ${installation}`,
  text: approved
    ? [
        `Hello ${name},`,
        '',
        `Your application has been accepted — you are a member of ${installation},`,
        'and you are on the list for the next burn.',
        '',
        link,
        '',
        installation,
      ].join('\n')
    : [
        `Hello ${name},`,
        '',
        'Your application has not been accepted this time. If you would like to',
        'know more, the organisers are the people to ask — their names and how to',
        'reach them are on your page:',
        '',
        link,
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

const DIGEST_SWITCH = 'You can change how often this arrives, or stop it, under Your details → Notifications.'

const countOf = (sections: readonly { entries: readonly unknown[] }[]): number =>
  sections.reduce((total, section) => total + section.entries.length, 0)

export const digestMessage = ({
  installation,
  to,
  sections,
  settings,
}: {
  installation: string
  to: string
  sections: readonly { label: string; entries: readonly { body: string; link: string | undefined }[] }[]
  settings: string | undefined
}): Message => {
  const total = countOf(sections)

  return {
    to,
    subject: `${installation}: ${total === 1 ? '1 thing' : `${total} things`} you have not seen`,
    text: [
      'While you have been away:',
      '',
      ...sections.flatMap((section) => [
        section.entries.length === 1 ? section.label : `${section.label} (${section.entries.length})`,
        ...section.entries.flatMap((entry) => [
          `- ${entry.body}`,
          ...(entry.link === undefined ? [] : [`  ${entry.link}`]),
        ]),
        '',
      ]),
      '--',
      DIGEST_SWITCH,
      ...(settings === undefined ? [] : [settings]),
    ].join('\n'),
  }
}

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
