/**
 * What a push payload means, decided here so it can be tested (#279).
 *
 * Same split as `cache.ts`: `main.ts` wires browser events to these answers and
 * holds no decision of its own. This one existed as three inline narrowings and a
 * pair of hardcoded literals, which is how every notification came to open the admin
 * applications page — including the ones a member is not allowed to read.
 */

/** Where a notification with no page of its own sends somebody. */
export const HOME = '/'

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
  path: string
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
 * A path this app can open, or home.
 *
 * The link is the server's own, so this is a floor rather than a defence — but it is
 * a cheap one, and `openWindow` takes a URL: `//elsewhere.example` is a
 * protocol-relative address rather than a path, and would leave the app entirely.
 */
const pathIn = (link: string | undefined): string =>
  link !== undefined && link.startsWith('/') && !link.startsWith('//') ? link : HOME

export const alertFrom = (raw: unknown): Alert => {
  const category = stringAt(raw, 'category')

  return {
    body: stringAt(raw, 'body') ?? UNREADABLE,
    path: pathIn(stringAt(raw, 'link')),
    tag: category === undefined ? 'sage-burner' : `sage-burner-${category}`,
  }
}
