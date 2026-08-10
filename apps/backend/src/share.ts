const DESCRIPTION_LIMIT = 200

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

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

export const truncate = (text: string, limit: number): string => {
  if (text.length <= limit) return text

  const cut = text.slice(0, limit - 1)
  const space = cut.lastIndexOf(' ')

  return `${(space > limit / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}

export interface ShareEvent {
  name: string
  start_date: string
  end_date: string
  start_time: string
  end_time: string
  location: string
  welcome_markdown: string
}

export interface ShareImage {
  path: string
  type: string
  width?: number
  height?: number
}

export interface ShareSubject {
  installation: string
  event?: ShareEvent
  image?: ShareImage
  origin?: string
}

const describe = ({ start_date, end_date, location, welcome_markdown }: ShareEvent): string => {
  const dates = start_date === end_date ? start_date : `${start_date} – ${end_date}`
  const heading = location === '' ? dates : `${dates} · ${location}`
  const welcome = plainFromMarkdown(welcome_markdown)

  return truncate(welcome === '' ? heading : `${heading} · ${welcome}`, DESCRIPTION_LIMIT)
}

const meta = (key: 'name' | 'property', name: string, content: string) =>
  `<meta ${key}="${name}" content="${escapeHtml(content)}" />`

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

const isLandscape = (image: ShareImage | undefined): boolean =>
  image?.width !== undefined && image.width >= 600 && image.width > (image.height ?? image.width)

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
    meta('property', 'og:locale', 'en_US'),
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
