import { describe, expect, it } from 'vitest'

import {
  accountRoles,
  applicationStatuses,
  connectionHref,
  connectionKindInfo,
  connectionKinds,
  connectionValue,
  effortLevels,
  emailsByDefault,
  eventOptionKinds,
  facebookProfileLink,
  feedKinds,
  feedKindsFrom,
  feedKindsQuery,
  formQuestionTypes,
  inviteStatuses,
  inviteStatusOf,
  isAccountRole,
  isApplicationStatus,
  isEffortLevel,
  isEventOptionKind,
  isFeedKind,
  isFormQuestionType,
  isInviteStatus,
  isPaymentStatus,
  isPlaceColor,
  notificationCategories,
  paymentStatuses,
  placeColors,
  threadEntityTypes,
} from './enums.ts'

describe('enum type guards', () => {
  const cases = [
    { name: 'account role', values: accountRoles, guard: isAccountRole },
    { name: 'application status', values: applicationStatuses, guard: isApplicationStatus },
    { name: 'form question type', values: formQuestionTypes, guard: isFormQuestionType },
    { name: 'payment status', values: paymentStatuses, guard: isPaymentStatus },
    { name: 'invite status', values: inviteStatuses, guard: isInviteStatus },
    { name: 'effort level', values: effortLevels, guard: isEffortLevel },
    { name: 'event option kind', values: eventOptionKinds, guard: isEventOptionKind },
    { name: 'place colour', values: placeColors, guard: isPlaceColor },
    { name: 'feed kind', values: feedKinds, guard: isFeedKind },
  ]

  for (const { name, values, guard } of cases) {
    describe(name, () => {
      it('accepts every declared value', () => {
        for (const value of values) expect(guard(value)).toBe(true)
      })

      it('rejects unknown strings', () => {
        expect(guard('definitely-not-a-value')).toBe(false)
        expect(guard('')).toBe(false)
      })

      it('rejects non-strings, so JSON from the wire cannot sneak through', () => {
        for (const value of [null, undefined, 0, 1, true, {}, []]) expect(guard(value)).toBe(false)
      })
    })
  }

  it('distinguishes admins from members', () => {
    expect(isAccountRole('admin')).toBe(true)
    expect(isAccountRole('Admin')).toBe(false)
    expect(isAccountRole('superuser')).toBe(false)
  })
})

describe('the feed filter carried in a URL', () => {
  it('has a chip for every kind of card, and nothing else', () => {
    expect([...feedKinds]).toEqual([...threadEntityTypes])
  })

  it('reads the kinds a URL asks for', () => {
    expect(feedKindsFrom('session,song')).toEqual(['session', 'song'])
  })

  it('reads nothing as everything, so an absent parameter filters nothing', () => {
    expect(feedKindsFrom(undefined)).toEqual([])
    expect(feedKindsFrom('')).toEqual([])
  })

  it('reads a parameter repeated in the URL as nothing, rather than throwing', () => {
    expect(feedKindsFrom(['session', 'song'])).toEqual([])
    expect(feedKindsFrom(null)).toEqual([])
    expect(feedKindsFrom(7)).toEqual([])
  })

  it('drops a kind it does not know, so a stale link shows more rather than failing', () => {
    expect(feedKindsFrom('session,dremas')).toEqual(['session'])
    expect(feedKindsFrom('dremas')).toEqual([])
  })

  it('says each kind once, however often a URL repeats it', () => {
    expect(feedKindsFrom('song,song')).toEqual(['song'])
    expect(feedKindsQuery(['song', 'song'])).toBe('?kinds=song')
  })

  it('writes the kinds asked for', () => {
    expect(feedKindsQuery(['session', 'song'])).toBe('?kinds=session,song')
  })

  it('writes no parameter for everything, whether that is said as nothing or as every kind', () => {
    expect(feedKindsQuery([])).toBe('')
    expect(feedKindsQuery(feedKinds)).toBe('')
  })

  it('round-trips what it writes', () => {
    expect(feedKindsFrom(feedKindsQuery(['attendance', 'post']).slice('?kinds='.length))).toEqual([
      'attendance',
      'post',
    ])
  })
})

describe('inviteStatusOf', () => {
  const at = (iso: string) => new Date(iso)

  it('is revoked once the door is shut, whatever the expiry still says', () => {
    const shut = {
      expires_at: '2027-01-01T00:00:00.000Z',
      used_at: null,
      revoked_at: '2026-08-01T00:00:00.000Z',
    }
    expect(inviteStatusOf(shut, at('2026-07-01T00:00:00.000Z'))).toBe('revoked')
  })

  it('is full once as many have come in as the cap allows', () => {
    const link = { expires_at: '2027-01-01T00:00:00.000Z', used_at: null, max_uses: 2, redemptions: 2 }
    expect(inviteStatusOf(link, at('2026-07-01T00:00:00.000Z'))).toBe('full')
  })

  it('is outstanding below the cap, which is the passing sibling', () => {
    const link = { expires_at: '2027-01-01T00:00:00.000Z', used_at: null, max_uses: 2, redemptions: 1 }
    expect(inviteStatusOf(link, at('2026-07-01T00:00:00.000Z'))).toBe('outstanding')
  })

  it('never runs out when no cap was set, however many have used it', () => {
    const link = { expires_at: '2027-01-01T00:00:00.000Z', used_at: null, max_uses: null, redemptions: 99 }
    expect(inviteStatusOf(link, at('2026-07-01T00:00:00.000Z'))).toBe('outstanding')
  })

  it('says used before revoked, and revoked before expired, one end being enough', () => {
    const both = {
      expires_at: '2020-01-01T00:00:00.000Z',
      used_at: '2026-01-01T00:00:00.000Z',
      revoked_at: '2026-01-02T00:00:00.000Z',
    }
    expect(inviteStatusOf(both, at('2026-07-01T00:00:00.000Z'))).toBe('used')

    const shutAndStale = {
      expires_at: '2020-01-01T00:00:00.000Z',
      used_at: null,
      revoked_at: '2026-01-02T00:00:00.000Z',
    }
    expect(inviteStatusOf(shutAndStale, at('2026-07-01T00:00:00.000Z'))).toBe('revoked')
  })

  it('says expired before full, a closed door outranking a full one', () => {
    const link = { expires_at: '2020-01-01T00:00:00.000Z', used_at: null, max_uses: 1, redemptions: 5 }
    expect(inviteStatusOf(link, at('2026-07-01T00:00:00.000Z'))).toBe('expired')
  })

  it('is outstanding while the expiry is still ahead', () => {
    expect(
      inviteStatusOf({ expires_at: '2026-08-01T00:00:00Z', used_at: null }, at('2026-07-31T23:59:59Z')),
    ).toBe('outstanding')
  })

  it('is expired once the expiry has passed', () => {
    expect(
      inviteStatusOf({ expires_at: '2026-08-01T00:00:00Z', used_at: null }, at('2026-08-01T00:00:01Z')),
    ).toBe('expired')
  })

  it('is expired exactly at the expiry, which is what the create route refuses', () => {
    expect(
      inviteStatusOf({ expires_at: '2026-08-01T00:00:00Z', used_at: null }, at('2026-08-01T00:00:00Z')),
    ).toBe('expired')
  })

  it('is used whether or not the expiry has passed', () => {
    const used = { used_at: '2026-07-02T00:00:00Z' }
    expect(inviteStatusOf({ expires_at: '2026-08-01T00:00:00Z', ...used }, at('2026-07-03T00:00:00Z'))).toBe(
      'used',
    )
    expect(inviteStatusOf({ expires_at: '2026-07-01T00:00:00Z', ...used }, at('2026-08-03T00:00:00Z'))).toBe(
      'used',
    )
  })
})

describe('where a way of being reached points', () => {
  it('builds an address for the networks that have one', () => {
    expect(connectionHref('email', 'wren@example.org')).toBe('mailto:wren@example.org')
    expect(connectionHref('instagram', 'wren')).toBe('https://instagram.com/wren')
    expect(connectionHref('tiktok', 'wren')).toBe('https://tiktok.com/@wren')
  })

  it('takes a handle with or without its @', () => {
    expect(connectionHref('instagram', '@wren')).toBe('https://instagram.com/wren')
    expect(connectionHref('tiktok', '@wren')).toBe('https://tiktok.com/@wren')
  })

  it('reads the server out of a Mastodon address, which carries its own', () => {
    expect(connectionHref('mastodon', '@wren@chaos.social')).toBe('https://chaos.social/@wren')
    expect(connectionHref('mastodon', 'wren@chaos.social')).toBe('https://chaos.social/@wren')
  })

  it('has nowhere to send somebody for a Mastodon address with no server', () => {
    expect(connectionHref('mastodon', '@wren')).toBeUndefined()
  })

  it('offers no link for a value kept whole, rather than a dead one', () => {
    expect(connectionHref('mastodon', 'https://chaos.social/@wren/statuses/1')).toBeUndefined()
    expect(connectionHref('mastodon', 'https://chaos.social/@wren\\x')).toBeUndefined()
    expect(connectionHref('mastodon', 'chaos.social/@wren/statuses/1')).toBeUndefined()
    expect(connectionHref('mastodon', 'chaos.social/@wren\\x')).toBeUndefined()
  })

  it('says there is nowhere to go for the ones with no profile page', () => {
    expect(connectionHref('discord', 'wren')).toBeUndefined()
    expect(connectionHref('signal', '+46701234567')).toBeUndefined()
  })

  it('dials a number however it was written', () => {
    expect(connectionHref('phone', '+46 70 123 45 67')).toBe('tel:+46701234567')
    expect(connectionHref('whatsapp', '+46-70-123 45 67')).toBe('https://wa.me/46701234567')
  })

  it('refuses to point anywhere a browser should not be sent', () => {
    for (const value of ['javascript:alert(1)', 'http://insecure.example', 'wren.example', '']) {
      expect(connectionHref('link', value)).toBeUndefined()
    }
  })

  it('follows an https link somebody typed', () => {
    expect(connectionHref('link', 'https://wren.example/photos')).toBe('https://wren.example/photos')
  })

  it('builds only addresses a browser should be sent to, for every kind', () => {
    const schemes = new Set<string>()

    for (const kind of connectionKinds) {
      expect(connectionKindInfo[kind].label).not.toBe('')
      expect(connectionKindInfo[kind].hint).not.toBe('')
      expect(connectionKindInfo[kind].icon).not.toBe('')

      for (const nasty of ['javascript:alert(1)', 'wren', '  ', '<script>', 'https://ok.example/x']) {
        const href = connectionHref(kind, nasty)
        if (href !== undefined) schemes.add(href.split(':')[0] ?? '')
      }
    }

    expect([...schemes].sort()).toEqual(['https', 'mailto', 'tel'])
  })

  it('writes to somebody on Messenger, which is what Facebook is as a contact', () => {
    expect(connectionHref('messenger', 'wren')).toBe('https://m.me/wren')
  })

  it('takes the numeric form of a Facebook account, which has no handle', () => {
    expect(connectionHref('messenger', '1234567890')).toBe('https://m.me/1234567890')
  })

  it('names only the one kind somebody titles themselves', () => {
    expect(connectionKinds.filter((kind) => connectionKindInfo[kind].labelled)).toEqual(['link'])
  })
})

describe('what is stored for a way of being reached', () => {
  it('reduces a pasted profile URL to the handle', () => {
    expect(connectionValue('instagram', 'https://instagram.com/wren')).toBe('wren')
    expect(connectionValue('instagram', 'https://www.instagram.com/wren/')).toBe('wren')
    expect(connectionValue('instagram', 'https://instagram.com/wren/?hl=en')).toBe('wren')
    expect(connectionValue('tiktok', 'https://www.tiktok.com/@wren')).toBe('wren')
  })

  it('reduces a pasted Facebook link to what Messenger needs, in both of its shapes', () => {
    expect(connectionValue('messenger', 'https://www.facebook.com/wren')).toBe('wren')
    expect(connectionValue('messenger', 'https://facebook.com/wren/')).toBe('wren')
    expect(connectionValue('messenger', 'https://facebook.com/profile.php?id=1234567890')).toBe('1234567890')
    expect(connectionValue('messenger', 'https://www.facebook.com/profile.php?locale=sv_SE&id=42')).toBe('42')
  })

  it('keeps a Facebook link whole when its first segment is not a handle', () => {
    expect(connectionValue('messenger', 'https://facebook.com/profile.php?id=abc')).toBe(
      'https://facebook.com/profile.php?id=abc',
    )
    expect(connectionValue('messenger', 'https://facebook.com/profile.php?myid=42')).toBe(
      'https://facebook.com/profile.php?myid=42',
    )
    expect(connectionValue('messenger', 'https://www.facebook.com/people/Wren/123456/')).toBe(
      'https://www.facebook.com/people/Wren/123456/',
    )
  })

  it('agrees with itself about what Facebook is, on both branches', () => {
    expect(connectionValue('messenger', 'https://notfacebook.com/profile.php?id=123')).toBe(
      'https://notfacebook.com/profile.php?id=123',
    )
    expect(connectionValue('messenger', 'https://evil.example?x=facebook.com/profile.php?id=123')).toBe(
      'https://evil.example?x=facebook.com/profile.php?id=123',
    )
    expect(connectionValue('messenger', 'https://m.facebook.com/profile.php?id=123')).toBe('123')
    expect(connectionValue('messenger', 'https://m.facebook.com/wren')).toBe('wren')
  })

  it('reduces a pasted Mastodon URL to the address its own network uses', () => {
    expect(connectionValue('mastodon', 'https://chaos.social/@wren')).toBe('@wren@chaos.social')
    expect(connectionValue('mastodon', 'https://chaos.social/@wren/')).toBe('@wren@chaos.social')
  })

  it('drops the @ people type in front of a handle', () => {
    expect(connectionValue('instagram', '@wren')).toBe('wren')
    expect(connectionValue('tiktok', ' @wren ')).toBe('wren')
  })

  it('leaves a bare handle and an ordinary address alone', () => {
    expect(connectionValue('instagram', 'wren')).toBe('wren')
    expect(connectionValue('mastodon', '@wren@chaos.social')).toBe('@wren@chaos.social')
    expect(connectionValue('discord', ' wren ')).toBe('wren')
    expect(connectionValue('link', ' https://wren.example/photos ')).toBe('https://wren.example/photos')
  })

  it('reads a pasted host the way a browser would', () => {
    expect(connectionValue('messenger', 'https://evil.example\\.facebook.com/wren')).toBe(
      'https://evil.example\\.facebook.com/wren',
    )
    expect(connectionValue('instagram', 'https://evil.example\\.instagram.com/wren')).toBe(
      'https://evil.example\\.instagram.com/wren',
    )
  })

  it('reads a path the way a browser segments it', () => {
    expect(connectionValue('instagram', 'https://instagram.com/a\\b/c')).toBe('a')
  })

  it('keeps a Mastodon URL whole when the segment is not just a handle', () => {
    expect(connectionValue('mastodon', 'https://chaos.social/@wren\\x')).toBe('https://chaos.social/@wren\\x')
  })

  it('does not mistake somebody else’s URL for a handle', () => {
    expect(connectionValue('instagram', 'https://example.org/wren')).toBe('https://example.org/wren')
    expect(connectionValue('mastodon', 'https://chaos.social/@wren/statuses/1')).toBe(
      'https://chaos.social/@wren/statuses/1',
    )
  })

  it('makes the link that a pasted URL would otherwise have broken', () => {
    expect(connectionHref('instagram', connectionValue('instagram', 'https://instagram.com/wren'))).toBe(
      'https://instagram.com/wren',
    )
    expect(connectionHref('mastodon', connectionValue('mastodon', 'https://chaos.social/@wren'))).toBe(
      'https://chaos.social/@wren',
    )
  })

  describe('a profile URL Facebook itself answered', () => {
    it('keeps a link on Facebook, whichever subdomain it is on', () => {
      expect(facebookProfileLink('https://www.facebook.com/wren')).toBe('https://www.facebook.com/wren')
      expect(facebookProfileLink('https://facebook.com/profile.php?id=1234567890')).toBe(
        'https://facebook.com/profile.php?id=1234567890',
      )
      expect(facebookProfileLink('  https://m.facebook.com/wren  ')).toBe('https://m.facebook.com/wren')
    })

    it('refuses a host a browser would read differently', () => {
      expect(facebookProfileLink('https://evil.example\\.facebook.com/wren')).toBeUndefined()
    })

    it('refuses a userinfo form, as it always did', () => {
      expect(facebookProfileLink('https://evil.example\\@facebook.com/wren')).toBeUndefined()
      expect(facebookProfileLink('https://evil.example@facebook.com/wren')).toBeUndefined()
    })

    it('refuses a host that only looks like Facebook', () => {
      expect(facebookProfileLink('https://notfacebook.com/wren')).toBeUndefined()
      expect(facebookProfileLink('https://evil.example?x=facebook.com/wren')).toBeUndefined()
      expect(facebookProfileLink('https://facebook.com.evil.example/wren')).toBeUndefined()
    })

    it('refuses anything that is not https, and nothing at all', () => {
      expect(facebookProfileLink('http://facebook.com/wren')).toBeUndefined()
      expect(facebookProfileLink('javascript:alert(1)')).toBeUndefined()
      expect(facebookProfileLink('')).toBeUndefined()
      expect(facebookProfileLink(undefined)).toBeUndefined()
    })
  })
})

describe('which categories are emailed before anybody has said anything', () => {
  it('emails news about your own application, an applicant not being here to see a bell', () => {
    expect(emailsByDefault('application_news')).toBe(true)
  })

  it('emails nothing else, so an upgrade never starts posting to somebody’s inbox', () => {
    expect(notificationCategories.filter(emailsByDefault)).toEqual(['application_news'])
  })
})
