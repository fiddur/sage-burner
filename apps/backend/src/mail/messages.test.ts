import { describe, expect, it } from 'vitest'

import {
  absolute,
  decisionMessage,
  digestMessage,
  inviteMessage,
  notificationMessage,
  replyMessage,
  resetMessage,
  testMessage,
} from './messages.ts'

describe('an absolute link', () => {
  it('is the origin and the path', () => {
    expect(absolute('https://burn.example.org', '/meals')).toBe('https://burn.example.org/meals')
  })

  it('is nothing at all where this app does not know its own address', () => {
    expect(absolute(undefined, '/meals')).toBeUndefined()
  })
})

describe('the invite', () => {
  const invite = inviteMessage({
    installation: 'The Burning Sage',
    to: 'ada@example.org',
    name: 'Ada',
    link: 'https://burn.example.org/invite/a-token',
    expires: '2026-09-06',
  })

  it('names the installation in the subject, not the software', () => {
    expect(invite.subject).toBe('You are invited to The Burning Sage')
  })

  it('carries the link, which exists here and in the approval and nowhere else', () => {
    expect(invite.text).toContain('https://burn.example.org/invite/a-token')
  })

  it('says when it stops working, since an expired link explains nothing itself', () => {
    expect(invite.text).toContain('2026-09-06')
  })

  it('greets them by the name they applied with', () => {
    expect(invite.text).toContain('Hello Ada,')
  })

  it('keeps the link on a line of its own, and every line short', () => {
    expect(invite.text.split('\n')).toContain('https://burn.example.org/invite/a-token')
    for (const line of invite.text.split('\n')) expect(line.length).toBeLessThanOrEqual(76)
  })

  it('goes to the address they applied with', () => {
    expect(invite.to).toBe('ada@example.org')
  })
})

describe('the password reset', () => {
  const reset = resetMessage({
    installation: 'The Burning Sage',
    to: 'ada@example.org',
    name: 'Ada',
    link: 'https://burn.example.org/reset/a-token',
    hours: 2,
  })

  it('names the installation in the subject, not the software', () => {
    expect(reset.subject).toBe('Setting a new password at The Burning Sage')
  })

  it('keeps the link on a line of its own, and every line short', () => {
    expect(reset.text.split('\n')).toContain('https://burn.example.org/reset/a-token')
    for (const line of reset.text.split('\n')) expect(line.length).toBeLessThanOrEqual(76)
  })

  it('tells whoever did not ask for it that nothing has happened', () => {
    expect(reset.text.replaceAll('\n', ' ')).toContain('If it was not you who asked, nothing has happened')
  })

  it('greets an account that has never given a name without a gap where one goes', () => {
    const nameless = resetMessage({
      installation: 'The Burning Sage',
      to: 'ada@example.org',
      name: null,
      link: 'https://burn.example.org/reset/a-token',
      hours: 2,
    })

    expect(nameless.text).toContain('Hello,')
    expect(nameless.text).not.toContain('Hello ,')
  })
})

describe('a notification', () => {
  it('is the same sentence the bell shows, with the page it belongs to', () => {
    const message = notificationMessage({
      installation: 'The Burning Sage',
      to: 'ada@example.org',
      body: 'You are on helper for Dinner',
      link: 'https://burn.example.org/meals',
    })

    expect(message.subject).toBe('The Burning Sage: You are on helper for Dinner')
    expect(message.text).toContain('You are on helper for Dinner')
    expect(message.text).toContain('https://burn.example.org/meals')
  })

  it('says where to switch them off, on every one', () => {
    const message = notificationMessage({
      installation: 'The Burning Sage',
      to: 'ada@example.org',
      body: 'Something happened',
      link: undefined,
    })

    expect(message.text).toContain('Your details → Notifications')
  })

  it('leaves out the link rather than writing a relative one', () => {
    const message = notificationMessage({
      installation: 'The Burning Sage',
      to: 'ada@example.org',
      body: 'Something happened',
      link: undefined,
    })

    expect(message.text).not.toContain('http')
  })
})

describe('the test message', () => {
  it('says what it proves and where the settings are', () => {
    const message = testMessage({ installation: 'The Burning Sage', to: 'admin@example.org' })

    expect(message.subject).toBe('The Burning Sage: mail is working')
    expect(message.to).toBe('admin@example.org')
    expect(message.text).toContain('Organise → Settings')
  })
})

describe('the digest', () => {
  const sections = [
    {
      kind: 'session' as const,
      label: 'Dreams',
      total: 1,
      entries: [{ body: 'Ada commented', burn: 'Summer burn', link: undefined }],
    },
  ]

  it('names where the settings are once, not once in the sentence and again in the link', () => {
    const digest = digestMessage({
      installation: 'The Burning Sage',
      to: 'ada@example.org',
      sections,
      origin: 'https://burn.example.org',
    })

    expect(digest.html.match(/Your details/gu)).toHaveLength(1)
  })

  it('still says where they are when there is no link to give', () => {
    const digest = digestMessage({
      installation: 'The Burning Sage',
      to: 'ada@example.org',
      sections,
      origin: undefined,
    })

    expect(digest.text.replaceAll(/\s+/gu, ' ')).toContain('Your details → Notifications')
  })

  it('sends the remainder to the feed it is a slice of, filtered to that kind', () => {
    const digest = digestMessage({
      installation: 'The Burning Sage',
      to: 'ada@example.org',
      sections: [
        {
          kind: 'song',
          label: 'Songs',
          total: 8,
          entries: [{ body: 'Ada added one', burn: 'Songbook', link: 'https://burn.example.org/songs/one' }],
        },
      ],
      origin: 'https://burn.example.org',
    })

    expect(digest.text).toContain('  https://burn.example.org/feed?kinds=song')
  })

  it('says which burn each line is about, both parts', () => {
    const digest = digestMessage({
      installation: 'The Burning Sage',
      to: 'ada@example.org',
      sections,
      origin: 'https://burn.example.org',
    })

    expect(digest.text).toContain('- Ada commented (Summer burn)')
    expect(digest.html).toContain('(Summer burn)')
  })

  it('says nothing where a line belongs nowhere', () => {
    const digest = digestMessage({
      installation: 'The Burning Sage',
      to: 'ada@example.org',
      sections: [
        {
          kind: 'session',
          label: 'Dreams',
          total: 1,
          entries: [{ body: 'Ada commented', burn: undefined, link: undefined }],
        },
      ],
      origin: undefined,
    })

    expect(digest.text.split('\n')).toContain('- Ada commented')
  })

  it('still prints the remainder where there is no origin to build a link from', () => {
    const digest = digestMessage({
      installation: 'The Burning Sage',
      to: 'ada@example.org',
      sections: [
        {
          kind: 'song',
          label: 'Songs',
          total: 8,
          entries: [{ body: 'Ada added one', burn: 'Songbook', link: undefined }],
        },
      ],
      origin: undefined,
    })

    expect(digest.text).toContain('and 7 more')
    expect(digest.text).not.toContain('http')
  })
})

describe('what a letter about an application says at the foot', () => {
  const settled = (link: string | undefined) =>
    decisionMessage({
      installation: 'The Burning Sage',
      to: 'ada@example.org',
      name: 'Ada',
      approved: false,
      link,
    })

  it('names no switch to a rejected applicant, who has no page to press one on', () => {
    expect(settled('https://burn.example.org/apply').text).not.toContain('Your details')
    expect(settled('https://burn.example.org/apply').text).toContain('because you applied to join')
  })

  it('names the switch to somebody approved, the role granted a moment earlier reaching it', () => {
    const welcomed = decisionMessage({
      installation: 'The Burning Sage',
      to: 'ada@example.org',
      name: 'Ada',
      approved: true,
      link: 'https://burn.example.org/',
    })

    expect(welcomed.text).toContain('Your details → Notifications')
  })

  it('promises a rejected applicant nothing further, which a new member cannot be promised', () => {
    expect(settled(undefined).text.replaceAll('\n', ' ')).toContain(
      'Nothing else is sent to you unless you ask for it',
    )
    expect(
      decisionMessage({
        installation: 'The Burning Sage',
        to: 'ada@example.org',
        name: 'Ada',
        approved: true,
        link: 'https://burn.example.org/',
      }).text,
    ).not.toContain('Nothing else is sent to you')
  })

  it('ends the rejection on a full stop where there is no page to point at', () => {
    expect(settled(undefined).text).toContain('are on your page.')
    expect(settled(undefined).text).not.toContain('are on your page:')
  })

  it('keeps the colon where the button follows it', () => {
    expect(settled('https://burn.example.org/apply').text).toContain('are on your page:')
  })

  it('says the same of a reply, which the applicant cannot switch off either', () => {
    const reply = replyMessage({
      installation: 'The Burning Sage',
      to: 'ada@example.org',
      name: 'Ada',
      said: 'Who are you coming with?',
      link: undefined,
    })

    expect(reply.text).toContain('because you applied to join')
    expect(reply.text).toContain('> Who are you coming with?')
  })
})
