/**
 * What a push payload means, decided here so it can be tested (#279).
 *
 * Same split as `cache.ts`: `main.ts` wires browser events to these answers and
 * holds no decision of its own. This one existed as three inline narrowings and a
 * pair of hardcoded literals, which is how every notification came to open the admin
 * applications page — including the ones a member is not allowed to read.
 */

/** Where a notification with no page of its own opens, when nothing is open already. */
export const HOME = '/'

/**
 * What the worker asks an open window to do when a notification names a page it is
 * not showing.
 *
 * A message rather than `client.navigate()`, which is a full page load and would
 * discard whatever somebody had typed into a markdown editor — the thing the dream
 * panel was rewritten to stop doing. The app routes it in place instead.
 */
export const ROUTE_TO = 'sage-burner:route-to'

/** The path an open window is being asked to show, if that is what a message is. */
export const routeAsked = (data: unknown): string | undefined => {
  if (typeof data !== 'object' || data === null) return undefined
  if (Reflect.get(data, 'type') !== ROUTE_TO) return undefined

  const path = Reflect.get(data, 'path')

  return typeof path === 'string' ? path : undefined
}

/**
 * What is shown when the payload cannot be read at all.
 *
 * Something happened, and silence is the worse failure. The push service cannot read
 * the payload — it is encrypted to this browser's key — so a malformed one is our bug
 * rather than anything in between.
 */
export const UNREADABLE = 'Something needs your attention.'

export interface Alert {
  body: string
  /**
   * The page it is about, or nothing.
   *
   * **Absent is not the homepage.** Several categories have no page of their own — a
   * new version is everywhere — and the difference decides what a tap does: a named
   * page is opened, an absent one means any window of this app is already the right
   * one and must not be navigated away from what somebody was reading.
   */
  path?: string
  /**
   * What this collapses with.
   *
   * **Per category, not per app.** Three applications arriving while a phone is
   * locked should be one line to act on rather than three identical ones to dismiss
   * — that was the original reason for a tag, and using one tag for everything made
   * a meal role replace a dream offer instead.
   */
  tag: string
}

const stringAt = (raw: unknown, key: string): string | undefined => {
  if (typeof raw !== 'object' || raw === null || !(key in raw)) return undefined

  const found = Reflect.get(raw, key)

  return typeof found === 'string' ? found : undefined
}

/**
 * Anywhere but here, to resolve against. Any fixed origin does — the only question
 * asked of it is whether resolving the link left it.
 */
const NOWHERE = 'https://app.invalid'

/**
 * A path this app can open, or home.
 *
 * The link is the server's own, so this is a floor rather than a defence — but
 * `openWindow` takes a URL, and a link that resolves elsewhere would leave the app
 * entirely.
 *
 * **Asked of the parser, not matched against.** This was `startsWith('/') &&
 * !startsWith('//')`, which the very inputs its test named walk straight past:
 * WHATWG parsing treats `\` as `/` for special schemes and strips tab and newline
 * before parsing, so `/\evil.example` and `/<tab>/evil.example` both satisfy that
 * pair and resolve to `https://evil.example/`. Measured, not reasoned about. An
 * escapable syntax loses to the thing that parses it; asking that thing instead
 * cannot be one escape behind.
 *
 * The answer is rebuilt from the parse rather than handed back as written, so what
 * `openWindow` gets is the normalised path — with the query and fragment kept, since
 * a link to a particular thing on a page is still a link to this app.
 */
const pathIn = (link: string | undefined): string | undefined => {
  if (link === undefined) return undefined

  try {
    const asked = new URL(link, NOWHERE)

    return asked.origin === NOWHERE ? `${asked.pathname}${asked.search}${asked.hash}` : undefined
  } catch {
    return undefined
  }
}

export const alertFrom = (raw: unknown): Alert => {
  const category = stringAt(raw, 'category')

  return {
    body: stringAt(raw, 'body') ?? UNREADABLE,
    path: pathIn(stringAt(raw, 'link')),
    tag: category === undefined ? 'sage-burner' : `sage-burner-${category}`,
  }
}
