import { describe, expect, it } from 'vitest'

import { ROUTE_TO, routeAsked } from '../worker-message.ts'
import { alertFrom, HOME, landOn, UNREADABLE } from './notification.ts'

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

  it('collapses the ones with no category together', () => {
    // Every push the server sends names one (#326), so this is what a payload from
    // before that looks like — a page still opens, and three of them are one line to
    // act on rather than three identical ones to dismiss.
    const first = alertFrom({ body: 'Someone has applied.', link: '/admin/applications' })
    const second = alertFrom({ body: 'Someone else has applied.', link: '/admin/applications' })

    expect(first.tag).toBe(second.tag)
    expect(first.path).toBe('/admin/applications')
    expect(first.tag).not.toBe(alertFrom({ body: 'x', link: '/meals', category: 'meal_role' }).tag)
  })

  it('gives an application its own tag, so it cannot replace a meal role', () => {
    const application = alertFrom({
      body: 'Someone has applied to join.',
      link: '/admin/applications',
      category: 'application',
    })

    expect(application.tag).toBe('sage-burner-application')
    expect(application.path).toBe('/admin/applications')
  })

  it('names no page for a payload that carries no link', () => {
    // What a row written before the redeploy notice took a page (#325) comes out as,
    // and what an off-origin link is reduced to. **Absent rather than `'/'`**, which is
    // a different instruction to the worker: any window of this app is already the
    // right one, so a tap focuses it instead of taking somebody off whatever they were
    // reading (#279).
    expect(
      alertFrom({ body: 'A new version is out.', link: null, category: 'new_version' }).path,
    ).toBeUndefined()
    expect(alertFrom({ body: 'a', category: 'new_version' }).path).toBeUndefined()
  })

  it('says something happened when the payload cannot be read at all', () => {
    // Silence is the worse failure: the push arrived, so something did happen.
    expect(alertFrom(undefined)).toEqual({ body: UNREADABLE, path: undefined, tag: 'sage-burner' })
    expect(alertFrom('not an object').body).toBe(UNREADABLE)
    expect(alertFrom({ body: 42 }).body).toBe(UNREADABLE)
  })

  it('refuses a link that would leave the app', () => {
    // `openWindow` takes a URL, so `//elsewhere.example` is an address rather than a
    // path. The link is the server's own, so this is a floor rather than a defence.
    expect(alertFrom({ body: 'a', link: '//elsewhere.example/x' }).path).toBeUndefined()
    expect(alertFrom({ body: 'a', link: 'https://elsewhere.example/x' }).path).toBeUndefined()
    expect(alertFrom({ body: 'a', link: 'javascript:alert(1)' }).path).toBeUndefined()
  })

  it('refuses the ones that walk past a leading-slash check', () => {
    // Both of these satisfy `startsWith('/') && !startsWith('//')`, which is what
    // this was, and both resolve to `https://elsewhere.example/`: WHATWG parsing
    // reads `\` as `/` for special schemes, and strips tab and newline before it
    // parses at all. Run against the old implementation, not reasoned about.
    expect(alertFrom({ body: 'a', link: '/\\elsewhere.example' }).path).toBeUndefined()
    expect(alertFrom({ body: 'a', link: '/\t/elsewhere.example' }).path).toBeUndefined()
    expect(alertFrom({ body: 'a', link: '/\n/elsewhere.example' }).path).toBeUndefined()
  })

  it('keeps an ordinary path, which is the case the one above must not break', () => {
    expect(alertFrom({ body: 'a', link: '/roles' }).path).toBe('/roles')
    expect(alertFrom({ body: 'a', link: '/schedule' }).path).toBe('/schedule')
  })

  it('keeps a query and a fragment, which still name something in this app', () => {
    expect(alertFrom({ body: 'a', link: '/schedule?dream=d-1#top' }).path).toBe('/schedule?dream=d-1#top')
  })
})

const ORIGIN = 'https://burn.example'

/**
 * Windows this worker can reach, and one list of everything it did to them — so a
 * test pins that a tap focused rather than opened, and that nothing else happened.
 */
const browserWith = (...urls: string[]) => {
  const did: unknown[] = []
  const windows = urls.map((url) => ({
    url,
    focus: () => {
      did.push({ focused: url })
      return Promise.resolve(url)
    },
    postMessage: (message: unknown) => {
      did.push({ told: url, message })
    },
  }))

  return {
    did,
    clients: {
      matchAll: () => Promise.resolve(windows),
      openWindow: (url: string) => {
        did.push({ opened: url })
        return Promise.resolve(null)
      },
    },
  }
}

describe('where a tap lands', () => {
  it('focuses a window that is open, without moving it, when no page is named', async () => {
    const browser = browserWith(`${ORIGIN}/meals`)

    await landOn(browser.clients, ORIGIN, undefined)

    expect(browser.did).toEqual([{ focused: `${ORIGIN}/meals` }])
  })

  it('opens home when no page is named and nothing is open', async () => {
    const browser = browserWith()

    await landOn(browser.clients, ORIGIN, undefined)

    expect(browser.did).toEqual([{ opened: HOME }])
  })

  it('focuses the window already showing the page rather than routing it', async () => {
    const browser = browserWith(`${ORIGIN}/meals`, `${ORIGIN}/schedule`)

    await landOn(browser.clients, ORIGIN, '/schedule')

    expect(browser.did).toEqual([{ focused: `${ORIGIN}/schedule` }])
  })

  it('counts one showing the page with a different query as showing it', async () => {
    // The window somebody left on a particular dream is still on the schedule, and
    // routing it would move them off what the notification is about.
    const browser = browserWith(`${ORIGIN}/schedule?dream=d-1#top`)

    await landOn(browser.clients, ORIGIN, '/schedule')

    expect(browser.did).toEqual([{ focused: `${ORIGIN}/schedule?dream=d-1#top` }])
  })

  it('routes a window on the same page when the link names something on it', async () => {
    // The other direction, and the reason the rule is asymmetric: a comment notification
    // names the dream it is about, so a window already sitting on the dreams page is not
    // showing it — focusing that window would land the tap on nothing (#375).
    const browser = browserWith(`${ORIGIN}/dreams`)

    await landOn(browser.clients, ORIGIN, '/dreams?burn=e-1&dream=s-1')

    expect(browser.did).toEqual([
      { focused: `${ORIGIN}/dreams` },
      { told: `${ORIGIN}/dreams`, message: { type: ROUTE_TO, path: '/dreams?burn=e-1&dream=s-1' } },
    ])
  })

  it('focuses a window already on the very dream it names', async () => {
    const browser = browserWith(`${ORIGIN}/dreams?burn=e-1&dream=s-1`)

    await landOn(browser.clients, ORIGIN, '/dreams?burn=e-1&dream=s-1')

    expect(browser.did).toEqual([{ focused: `${ORIGIN}/dreams?burn=e-1&dream=s-1` }])
  })

  it('asks a window showing something else to route in place, after focusing it', async () => {
    const browser = browserWith(`${ORIGIN}/meals`)

    await landOn(browser.clients, ORIGIN, '/schedule')

    expect(browser.did).toEqual([
      { focused: `${ORIGIN}/meals` },
      { told: `${ORIGIN}/meals`, message: { type: ROUTE_TO, path: '/schedule' } },
    ])
  })

  it('opens a window only when this app has none', async () => {
    const browser = browserWith()

    await landOn(browser.clients, ORIGIN, '/schedule')

    expect(browser.did).toEqual([{ opened: '/schedule' }])
  })

  it('passes over a window whose url will not parse instead of failing the tap', async () => {
    const browser = browserWith('not a url', `${ORIGIN}/schedule`)

    await landOn(browser.clients, ORIGIN, '/schedule')

    expect(browser.did).toEqual([{ focused: `${ORIGIN}/schedule` }])
  })
})

describe('the message asking an open window to move', () => {
  it('reads the path out of one the worker sent', () => {
    expect(routeAsked({ type: ROUTE_TO, path: '/meals' })).toBe('/meals')
  })

  it('ignores anything else on the channel, which is not ours to act on', () => {
    expect(routeAsked({ type: 'something-else', path: '/meals' })).toBeUndefined()
    expect(routeAsked({ path: '/meals' })).toBeUndefined()
    expect(routeAsked({ type: ROUTE_TO })).toBeUndefined()
    expect(routeAsked({ type: ROUTE_TO, path: 42 })).toBeUndefined()
    expect(routeAsked('a string')).toBeUndefined()
    expect(routeAsked(null)).toBeUndefined()
  })
})
