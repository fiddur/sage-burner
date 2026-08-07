/**
 * The card a link to this installation shows (#306).
 *
 * **Social crawlers do not run JavaScript.** Facebook, Slack, Signal, WhatsApp and
 * Mastodon fetch the HTML and read what is in the `<head>` of it — so the name of the
 * burn, which is a database row the app applies after load, has to be in the shell
 * before it is sent. This module builds those tags; `shell.ts` is what reads the rows
 * and serves the result.
 *
 * Kept apart from the request so all of it is testable as a string in, a string out.
 */

const DESCRIPTION_LIMIT = 200

/** For an attribute value. `'` too, since it costs nothing and a quote style may change. */
const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

/**
 * Markdown as a card would read it out: plain text, one line.
 *
 * Deliberately not a renderer. What a description wants is the words, and everything
 * that makes markdown markdown — the fences, the bullets, the link targets — is noise
 * once the formatting is gone. Emphasis marks are stripped wherever they appear rather
 * than only in pairs, which also takes the underscores out of `snake_case`; in a
 * two-sentence summary that is the better of the two mistakes.
 */
export const plainFromMarkdown = (markdown: string): string =>
  markdown
    .replaceAll(/```[\s\S]*?```/g, ' ')
    .replaceAll(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replaceAll(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replaceAll(/^ {0,3}#{1,6} +/gm, '')
    .replaceAll(/^ {0,3}> ?/gm, '')
    .replaceAll(/^ {0,3}[-*+] +/gm, '')
    .replaceAll(/^ {0,3}\d+\. +/gm, '')
    .replaceAll(/[*_~`]/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim()

/** At a word boundary where there is one near the end, so a card never cuts mid-word. */
export const truncate = (text: string, limit: number): string => {
  if (text.length <= limit) return text

  const cut = text.slice(0, limit - 1)
  const space = cut.lastIndexOf(' ')

  return `${(space > limit / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** The burn, as much of it as a card says anything about. */
export interface ShareEvent {
  name: string
  start_date: string
  end_date: string
  start_time: string
  end_time: string
  location: string
  welcome_markdown: string
}

/**
 * The picture, as a path this app serves.
 *
 * `width` and `height` are declared rather than measured — nothing in this process
 * decodes an image, so they are as true as the client that uploaded the bytes. The
 * cost of a lie is a card that lays out wrong.
 */
export interface ShareImage {
  path: string
  type: string
  /** Both absent for an SVG, which has no size of its own to declare. */
  width?: number
  height?: number
}

export interface ShareSubject {
  /** What this deployment calls itself: "The Burning Sage", not "Sage Burner". */
  installation: string
  event?: ShareEvent
  image?: ShareImage
  /** `https://burn.example.org`, when the request said enough to know it. */
  origin?: string
}

/**
 * The dates in front of the welcome text, which is where a human actually reads them.
 *
 * `og:type: event` is in the Open Graph spec and Facebook treats every type it has not
 * graduated as `other`, so nothing renders a typed date. The structured data below is
 * for Google; this line is for the person looking at the card.
 */
const describe = ({ start_date, end_date, location, welcome_markdown }: ShareEvent): string => {
  const dates = start_date === end_date ? start_date : `${start_date} – ${end_date}`
  const heading = location === '' ? dates : `${dates} · ${location}`
  const welcome = plainFromMarkdown(welcome_markdown)

  return truncate(welcome === '' ? heading : `${heading} · ${welcome}`, DESCRIPTION_LIMIT)
}

const meta = (key: 'name' | 'property', name: string, content: string) =>
  `<meta ${key}="${name}" content="${escapeHtml(content)}" />`

/**
 * Schema.org, which is the only mechanism that puts a typed date in front of anything.
 *
 * Google reads it for rich results; Facebook ignores it. Times are local and carry no
 * offset, which is what the burn's own `start_time` means — the app has no timezone
 * setting to convert them with, and `docs/burns.md` says why.
 *
 * `<` is escaped to its JSON form so no value can close this element early. The rest
 * of the card escapes for HTML; this one cannot, because the content is JSON.
 */
const structuredData = (subject: ShareSubject, image: string | undefined): string | undefined => {
  const { event, installation, origin } = subject
  if (event === undefined) return undefined

  const data = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.name,
    startDate: `${event.start_date}T${event.start_time}`,
    endDate: `${event.end_date}T${event.end_time}`,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    description: describe(event),
    organizer: { '@type': 'Organization', name: installation },
    ...(event.location === '' ? {} : { location: { '@type': 'Place', name: event.location } }),
    ...(origin === undefined ? {} : { url: origin }),
    ...(image === undefined ? {} : { image: [image] }),
  }

  return `<script type="application/ld+json">${JSON.stringify(data).replaceAll('<', '\\u003c')}</script>`
}

/**
 * Everything the card is made of, as tags to put in the shell's `<head>`.
 *
 * The subject is the open burn, falling back to the installation when there is none:
 * a deployment between burns still has a name, and "The Burning Sage" is a better card
 * than the software's own name with no picture — which is what this replaces.
 *
 * `og:url` and `og:image` must be absolute, and this app deliberately has no notion of
 * its own public address, so both are left out entirely when the request did not say
 * one. A relative `og:image` is not a smaller version of the feature; it is a crawler
 * fetching nothing.
 */
const imageTags = (image: ShareImage, absolute: string, alt: string): string[] => [
  meta('property', 'og:image', absolute),
  meta('property', 'og:image:type', image.type),
  ...(image.width === undefined || image.height === undefined
    ? []
    : [
        meta('property', 'og:image:width', String(image.width)),
        meta('property', 'og:image:height', String(image.height)),
      ]),
  meta('property', 'og:image:alt', alt),
]

/**
 * Whether the picture earns the large card.
 *
 * It needs a landscape image of about 600 × 315 or more. Claiming it for the square
 * icon gets a card that reserves space for a wide picture and then draws a logo
 * letterboxed into it — and an SVG declares no size at all, so it never qualifies.
 */
const isLandscape = (image: ShareImage | undefined): boolean =>
  image?.width !== undefined && image.width >= 600 && image.width > (image.height ?? image.width)

/**
 * What the card says in words.
 *
 * No description when there is no burn: the page then says there is nothing
 * scheduled, and a sentence about the software is what this issue set out to remove
 * rather than to reword.
 */
const wordTags = ({ installation, event }: ShareSubject, title: string): string[] => {
  const description = event === undefined ? undefined : describe(event)

  return [
    `<title>${escapeHtml(title)}</title>`,
    ...(description === undefined
      ? []
      : [meta('name', 'description', description), meta('property', 'og:description', description)]),
    meta('property', 'og:site_name', installation),
    meta('property', 'og:title', title),
    meta('property', 'og:type', event === undefined ? 'website' : 'event'),
    meta('property', 'og:locale', 'en'),
  ]
}

export const shareHead = (subject: ShareSubject): string => {
  const { installation, event, image, origin } = subject

  const title = event === undefined ? installation : `${event.name} · ${installation}`
  const absolute = origin === undefined || image === undefined ? undefined : `${origin}${image.path}`
  const jsonLd = structuredData(subject, absolute)
  const large = isLandscape(image) && absolute !== undefined

  return [
    ...wordTags(subject, title),
    ...(origin === undefined ? [] : [meta('property', 'og:url', origin)]),
    ...(absolute === undefined || image === undefined
      ? []
      : imageTags(image, absolute, event?.name ?? installation)),
    meta('name', 'twitter:card', large ? 'summary_large_image' : 'summary'),
    ...(jsonLd === undefined ? [] : [jsonLd]),
  ].join('\n    ')
}
