/**
 * What a push payload means, decided here so it can be tested (#279).
 *
 * Same split as `cache.ts`: `main.ts` wires browser events to these answers and
 * holds no decision of its own. This one existed as three inline narrowings and a
 * pair of hardcoded literals, which is how every notification came to open the admin
 * applications page — including the ones a member is not allowed to read.
 */

import { ROUTE_TO } from '../worker-message.ts'

/** Where a notification with no page of its own opens, when nothing is open already. */
export const HOME = '/'

/**
 * Enough of a window this worker can reach, so a test can supply one.
 *
 * Narrower than the real `WindowClient` on purpose, in the same spirit as `push.ts`'s
 * `PushBrowser`: this is every capability a tap uses. `Client` also carries `focused`
 * and `visibilityState`, and `landOn` deliberately does not ask — see there.
 */
export interface OpenWindow {
  focus: () => Promise<unknown>
  postMessage: (message: unknown) => void
  url: string
}

/** Enough of the worker's `clients` to land a tap on one of them. */
export interface WindowClients {
  matchAll: (options: { includeUncontrolled: boolean; type: 'window' }) => Promise<OpenWindow[]>
  openWindow: (url: string) => Promise<unknown>
}

/**
 * Whether a window is already showing the page, ignoring any query or fragment.
 *
 * A window that will not parse is not showing anything we can match, and a tap must
 * not die on one: the answer is no, and the next window is asked.
 */
const showing = (client: OpenWindow, path: string, origin: string): boolean => {
  try {
    return new URL(client.url).pathname === new URL(path, origin).pathname
  } catch {
    return false
  }
}

/**
 * Where a tap lands, in the order that costs somebody least (#279).
 *
 * A new window is the worst answer available and used to be the common one: the match
 * was a suffix of the whole URL, so an app open on `/meals` did not count as open for
 * anything else — including a notification naming no page at all, whose `/` a URL not
 * ending in a slash cannot end with. On a phone, where the worker belongs to the
 * browser rather than to the installed copy, that meant a browser tab instead of the
 * app that was already on screen.
 *
 * So: the window already showing it, else any window of ours asked to route in place,
 * else a new one. `postMessage` rather than `client.navigate()` — see `ROUTE_TO`. A
 * window loaded before this shipped has no listener for it and simply stays where it
 * is, which is still inside the app rather than beside it.
 *
 * Any window will do, and the first is taken: `Clients.matchAll` is specified to
 * sort top-level window clients most-recently-focused first, so on a phone the first
 * *is* the focused one, and nothing more of the API needs declaring to say so.
 */
export const landOn = async (
  clients: WindowClients,
  origin: string,
  path: string | undefined,
): Promise<unknown> => {
  const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true })
  const [anywhere] = windows

  // No page of its own. Any window of ours is already the right one, and routing it
  // would take somebody off what they were reading. Since #325 the redeploy notice does
  // name a page — the changelog — so what reaches this is a payload with no link at all:
  // a row written before that, or a category added later with nowhere to send anybody.
  if (path === undefined) {
    return anywhere === undefined ? clients.openWindow(HOME) : anywhere.focus()
  }

  const already = windows.find((client) => showing(client, path, origin))
  if (already !== undefined) return already.focus()

  if (anywhere === undefined) return clients.openWindow(path)

  await anywhere.focus()
  anywhere.postMessage({ type: ROUTE_TO, path })

  return anywhere
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
   * **Absent is not the homepage.** The difference decides what a tap does: a named
   * page is opened, an absent one means any window of this app is already the right one
   * and must not be navigated away from what somebody was reading. Every category names
   * a page today — the redeploy notice took one in #325 — so this is what a row written
   * before that, or a link that resolves off-origin, comes out as.
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
 * A path this app can open, or nothing.
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
 * `landOn` is given is the normalised path — with the query and fragment kept, since
 * a link to a particular thing on a page is still a link to this app.
 *
 * **Nothing, not home.** A link that leaves the app means "no page of its own" here,
 * which focuses a window somebody is already looking at rather than taking them to
 * the homepage — see `Alert.path`.
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
