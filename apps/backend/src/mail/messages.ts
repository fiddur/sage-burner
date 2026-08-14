import type { Message } from './mail.ts'
import type { Block } from './template.ts'

import { htmlFrom, textFrom } from './template.ts'

const OFF_SWITCH = 'You can turn these emails off under Your details → Notifications.'

const DIGEST_SWITCH = 'You can change how often this arrives, or stop it, under Your details → Notifications.'

export const absolute = (origin: string | undefined, path: string): string | undefined =>
  origin === undefined ? undefined : `${origin}${path}`

const written = ({
  installation,
  to,
  subject,
  blocks,
}: {
  installation: string
  to: string
  subject: string
  blocks: readonly Block[]
}): Message => ({
  to,
  subject,
  text: textFrom(blocks),
  html: htmlFrom({ installation, blocks }),
})

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
}): Message =>
  written({
    installation,
    to,
    subject: `You are invited to ${installation}`,
    blocks: [
      { paragraph: `Hello ${name},` },
      {
        paragraph: `Your application has been accepted. Follow this link to set up your account at ${installation}:`,
      },
      { action: { href: link, label: 'Set up your account' } },
      {
        paragraph: `The link works once, and until ${expires}. If it has expired by then, ask whoever invited you for a new one.`,
      },
      { note: installation },
    ],
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
}): Message =>
  written({
    installation,
    to,
    subject: approved ? `You are in at ${installation}` : `About your application to ${installation}`,
    blocks: [
      { paragraph: `Hello ${name},` },
      {
        paragraph: approved
          ? `Your application has been accepted — you are a member of ${installation}, and you are on the list for the next burn.`
          : 'Your application has not been accepted this time. If you would like to know more, the organisers are the people to ask — their names and how to reach them are on your page:',
      },
      { action: { href: link, label: approved ? 'See the burn' : 'Your page' } },
      { note: installation },
    ],
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
}): Message =>
  written({
    installation,
    to,
    subject: `${installation}: ${body}`,
    blocks: [
      { paragraph: body },
      ...(link === undefined ? [] : [{ action: { href: link, label: 'Have a look' } }]),
      { note: OFF_SWITCH },
    ],
  })

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

  return written({
    installation,
    to,
    subject: `${installation}: ${total === 1 ? '1 thing' : `${total} things`} you have not seen`,
    blocks: [
      { paragraph: 'While you have been away:' },
      ...sections.flatMap((section): Block[] => [
        {
          heading:
            section.entries.length === 1 ? section.label : `${section.label} (${section.entries.length})`,
        },
        {
          lines: section.entries.map((entry) => ({
            text: entry.body,
            ...(entry.link === undefined ? {} : { href: entry.link }),
          })),
        },
      ]),
      {
        note: DIGEST_SWITCH,
        ...(settings === undefined ? {} : { link: { href: settings, label: 'Your details' } }),
      },
    ],
  })
}

export const testMessage = ({ installation, to }: { installation: string; to: string }): Message =>
  written({
    installation,
    to,
    subject: `${installation}: mail is working`,
    blocks: [
      { paragraph: 'This is a test message from your own installation.' },
      {
        paragraph:
          'If you are reading it, the SMTP settings under Organise → Settings are right, and invites and notifications can go out from here.',
      },
      { note: installation },
    ],
  })
