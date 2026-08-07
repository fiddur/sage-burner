import { describe, expect, it } from 'vitest'

import { alertFrom, HOME, UNREADABLE } from './notification.ts'

describe('reading a push payload', () => {
  it('takes the wording, the page and the category the server sent', () => {
    expect(alertFrom({ body: 'You are on Friday dinner.', link: '/meals', category: 'meal_role' })).toEqual({
      body: 'You are on Friday dinner.',
      path: '/meals',
      tag: 'sage-burner-meal_role',
    })
  })

  it('collapses by category rather than into one line for the whole app', () => {
    // The reason a tag exists at all is that three applications on a locked phone
    // should be one thing to act on. One tag for everything made a meal role replace
    // a dream offer, which is the opposite of what that buys.
    const lead = alertFrom({ body: 'a', link: '/roles', category: 'lead_role' })
    const meal = alertFrom({ body: 'b', link: '/meals', category: 'meal_role' })

    expect(lead.tag).not.toBe(meal.tag)
    expect(alertFrom({ body: 'c', link: '/meals', category: 'meal_role' }).tag).toBe(meal.tag)
  })

  it('collapses the ones with no category together, which is what applications are', () => {
    // A new application is neither a bell row nor a setting — it predates both — so
    // it carries a link and no category. Those share one tag, which is the behaviour
    // it always had back when the worker had a page written into it.
    const first = alertFrom({ body: 'Someone has applied.', link: '/admin/applications' })
    const second = alertFrom({ body: 'Someone else has applied.', link: '/admin/applications' })

    expect(first.tag).toBe(second.tag)
    expect(first.path).toBe('/admin/applications')
    expect(first.tag).not.toBe(alertFrom({ body: 'x', link: '/meals', category: 'meal_role' }).tag)
  })

  it('sends somebody home rather than nowhere when there is no page for it', () => {
    // `link` is null for the categories with no page of their own — the schema says
    // so, and the row carries the same null.
    expect(alertFrom({ body: 'A new version is out.', link: null, category: 'new_version' }).path).toBe(HOME)
    expect(alertFrom({ body: 'a', category: 'new_version' }).path).toBe(HOME)
  })

  it('says something happened when the payload cannot be read at all', () => {
    // Silence is the worse failure: the push arrived, so something did happen.
    expect(alertFrom(undefined)).toEqual({ body: UNREADABLE, path: HOME, tag: 'sage-burner' })
    expect(alertFrom('not an object').body).toBe(UNREADABLE)
    expect(alertFrom({ body: 42 }).body).toBe(UNREADABLE)
  })

  it('refuses a link that would leave the app', () => {
    // `openWindow` takes a URL, so `//elsewhere.example` is an address rather than a
    // path. The link is the server's own, so this is a floor rather than a defence.
    expect(alertFrom({ body: 'a', link: '//elsewhere.example/x' }).path).toBe(HOME)
    expect(alertFrom({ body: 'a', link: 'https://elsewhere.example/x' }).path).toBe(HOME)
    expect(alertFrom({ body: 'a', link: 'javascript:alert(1)' }).path).toBe(HOME)
  })

  it('refuses the ones that walk past a leading-slash check', () => {
    // Both of these satisfy `startsWith('/') && !startsWith('//')`, which is what
    // this was, and both resolve to `https://elsewhere.example/`: WHATWG parsing
    // reads `\` as `/` for special schemes, and strips tab and newline before it
    // parses at all. Run against the old implementation, not reasoned about.
    expect(alertFrom({ body: 'a', link: '/\\elsewhere.example' }).path).toBe(HOME)
    expect(alertFrom({ body: 'a', link: '/\t/elsewhere.example' }).path).toBe(HOME)
    expect(alertFrom({ body: 'a', link: '/\n/elsewhere.example' }).path).toBe(HOME)
  })

  it('keeps an ordinary path, which is the case the one above must not break', () => {
    expect(alertFrom({ body: 'a', link: '/roles' }).path).toBe('/roles')
    expect(alertFrom({ body: 'a', link: '/schedule' }).path).toBe('/schedule')
  })

  it('keeps a query and a fragment, which still name something in this app', () => {
    expect(alertFrom({ body: 'a', link: '/schedule?dream=d-1#top' }).path).toBe('/schedule?dream=d-1#top')
  })
})
