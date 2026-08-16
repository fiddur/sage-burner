import { feedPage } from '@sage-burner/shared'
import { describe, expect, it } from 'vitest'

import { absolute, digestMessage, inviteMessage, notificationMessage, testMessage } from './messages.ts'

describe('an absolute link', () => {
  it('is the origin and the path', () => {
    expect(absolute('https://burn.example.org', '/meals')).toBe('https://burn.example.org/meals')
  })

  it('is nothing at all where this app does not know its own address', () => {
    // An email is read outside the app, so a relative path is no use — and a
    // notification is posted from wherever a role was handed out, with no request to
    // read `Host` from. Better to say what happened and stop there.
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
    // Quoted-printable soft-wraps past 76 columns. Decoders put it back, but not in
    // the middle of the one line that has to survive being clicked.
    expect(invite.text.split('\n')).toContain('https://burn.example.org/invite/a-token')
    for (const line of invite.text.split('\n')) expect(line.length).toBeLessThanOrEqual(76)
  })

  it('goes to the address they applied with', () => {
    expect(invite.to).toBe('ada@example.org')
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
    // A path in an inbox is not a link. Where the origin is unknown the message says
    // what happened and stops.
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
      entries: [{ body: 'Ada commented', link: undefined }],
    },
  ]

  it('names where the settings are once, not once in the sentence and again in the link', () => {
    const digest = digestMessage({
      installation: 'The Burning Sage',
      to: 'ada@example.org',
      sections,
      settings: 'https://burn.example.org/profile',
      origin: 'https://burn.example.org',
    })

    expect(digest.html.match(/Your details/gu)).toHaveLength(1)
  })

  it('still says where they are when there is no link to give', () => {
    // The passing sibling: dropping the words from the sentence would satisfy the test above
    // while leaving an installation without PUBLIC_ORIGIN saying nothing about the off switch.
    const digest = digestMessage({
      installation: 'The Burning Sage',
      to: 'ada@example.org',
      sections,
      settings: undefined,
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
          entries: [{ body: 'Ada added one', link: 'https://burn.example.org/songs/one' }],
        },
      ],
      settings: 'https://burn.example.org/profile',
      origin: 'https://burn.example.org',
    })

    expect(digest.text).toContain(`  https://burn.example.org${feedPage(['song'])}`)
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
          entries: [{ body: 'Ada added one', link: undefined }],
        },
      ],
      settings: undefined,
      origin: undefined,
    })

    expect(digest.text).toContain('and 7 more')
  })
})
