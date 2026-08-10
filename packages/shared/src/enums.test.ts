import { describe, expect, it } from 'vitest'

import {
  accountRoles,
  applicationStatuses,
  connectionHref,
  connectionKindInfo,
  connectionKinds,
  connectionValue,
  effortLevels,
  eventOptionKinds,
  facebookProfileLink,
  formQuestionTypes,
  inviteStatuses,
  inviteStatusOf,
  isAccountRole,
  isApplicationStatus,
  isEffortLevel,
  isEventOptionKind,
  isFormQuestionType,
  isInviteStatus,
  isPaymentStatus,
  isPlaceColor,
  paymentStatuses,
  placeColors,
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

describe('inviteStatusOf', () => {
  const at = (iso: string) => new Date(iso)

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
    // `POST /api/admin/invites` refuses an `expires_at` that is `<= now`, so an
    // invite minted at the boundary would be dead on arrival. The two comparisons
    // have to agree, and this is the edit that would silently break it.
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
    // People type it both ways, and a doubled @ is a link to nobody.
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

  it('says there is nowhere to go for the ones with no profile page', () => {
    // Discord is the one that matters: a username is a string you paste into Discord's
    // own search, so the page has to offer something to copy rather than an anchor.
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
    // What the type cannot give: `satisfies Record<ConnectionKind, ConnectionKindInfo>`
    // makes a missing `links` a compile error, so asserting it is a function proves
    // nothing (#395). What is worth asserting is what the functions produce — every href
    // reachable from this vocabulary carries a scheme the app is willing to emit, whatever
    // somebody typed into the box.
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
    // Looking at somebody's Facebook page is a different act and not a way of reaching
    // them; the profile page draws that from a linked sign-in (#393).
    expect(connectionHref('messenger', 'wren')).toBe('https://m.me/wren')
  })

  it('takes the numeric form of a Facebook account, which has no handle', () => {
    // An account with no vanity name is only ever `profile.php?id=…`, and Messenger takes
    // the number just the same.
    expect(connectionHref('messenger', '1234567890')).toBe('https://m.me/1234567890')
  })

  it('names only the one kind somebody titles themselves', () => {
    expect(connectionKinds.filter((kind) => connectionKindInfo[kind].labelled)).toEqual(['link'])
  })
})

describe('what is stored for a way of being reached', () => {
  it('reduces a pasted profile URL to the handle', () => {
    // What autofill and every "copy link" button hand over. Kept whole, it builds
    // `instagram.com/https://instagram.com/wren` and points at nobody.
    expect(connectionValue('instagram', 'https://instagram.com/wren')).toBe('wren')
    expect(connectionValue('instagram', 'https://www.instagram.com/wren/')).toBe('wren')
    expect(connectionValue('instagram', 'https://instagram.com/wren/?hl=en')).toBe('wren')
    expect(connectionValue('tiktok', 'https://www.tiktok.com/@wren')).toBe('wren')
  })

  it('reduces a pasted Facebook link to what Messenger needs, in both of its shapes', () => {
    expect(connectionValue('messenger', 'https://www.facebook.com/wren')).toBe('wren')
    expect(connectionValue('messenger', 'https://facebook.com/wren/')).toBe('wren')
    // An account with no vanity name has only this shape, and its path segment is
    // `profile.php` — reduced as a handle it would point at nobody.
    expect(connectionValue('messenger', 'https://facebook.com/profile.php?id=1234567890')).toBe('1234567890')
    expect(connectionValue('messenger', 'https://www.facebook.com/profile.php?locale=sv_SE&id=42')).toBe('42')
  })

  it('keeps a Facebook link whole when its first segment is not a handle', () => {
    // `handleIn` takes the first path segment, so these reduced to the literal
    // `profile.php` or `people` and rendered `m.me/profile.php` — a wrong handle stored
    // silently. Kept whole they are visibly wrong, which is the better failure (#398).
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
    // The numeric branch matched `[^\s/]*facebook\.com`, which takes `notfacebook.com` and
    // eats a whole authority — so a query string naming Facebook was read as one (#398).
    expect(connectionValue('messenger', 'https://notfacebook.com/profile.php?id=123')).toBe(
      'https://notfacebook.com/profile.php?id=123',
    )
    expect(connectionValue('messenger', 'https://evil.example?x=facebook.com/profile.php?id=123')).toBe(
      'https://evil.example?x=facebook.com/profile.php?id=123',
    )
    // The passing sibling, so anchoring has not simply refused everything: a subdomain is
    // still Facebook, on both branches.
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

  it('does not mistake somebody else’s URL for a handle', () => {
    // A link to an Instagram post is not a profile, and a URL on another host is not
    // Instagram at all — both stay as typed rather than becoming a wrong handle.
    expect(connectionValue('instagram', 'https://example.org/wren')).toBe('https://example.org/wren')
    expect(connectionValue('mastodon', 'https://chaos.social/@wren/statuses/1')).toBe(
      'https://chaos.social/@wren/statuses/1',
    )
  })

  it('makes the link that a pasted URL would otherwise have broken', () => {
    // The two halves together, which is the whole point of normalising on the way in.
    expect(connectionHref('instagram', connectionValue('instagram', 'https://instagram.com/wren'))).toBe(
      'https://instagram.com/wren',
    )
    expect(connectionHref('mastodon', connectionValue('mastodon', 'https://chaos.social/@wren'))).toBe(
      'https://chaos.social/@wren',
    )
  })

  describe('a profile URL Facebook itself answered', () => {
    it('keeps a link on Facebook, whichever subdomain it is on', () => {
      // The two shapes `user_link` actually answers: a vanity name, and `profile.php` for an
      // account without one.
      expect(facebookProfileLink('https://www.facebook.com/wren')).toBe('https://www.facebook.com/wren')
      expect(facebookProfileLink('https://facebook.com/profile.php?id=1234567890')).toBe(
        'https://facebook.com/profile.php?id=1234567890',
      )
      expect(facebookProfileLink('  https://m.facebook.com/wren  ')).toBe('https://m.facebook.com/wren')
    })

    it('refuses a host that only looks like Facebook', () => {
      // `facebookNumericId`'s mistake, which this must not repeat: a loose match takes
      // `notfacebook.com`, and one that eats an authority takes a query string naming Facebook
      // on somebody else's host. It lands in an `href` other members click.
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
