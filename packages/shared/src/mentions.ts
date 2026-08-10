import { profilePage } from './pages.ts'

export const MENTION_EVERYBODY = 'everybody'

export const MAX_MENTION_NAME = 80

export interface Mention {
  name: string
  target: string
}

// No `g` on the shared one: `exec`'s `lastIndex` would carry between calls.
const pattern = () => /@\[([^\][\n]{1,80})\]\(mention:([\w-]{1,64})\)/gu

// `[`, `]`, `(`, `)` and newlines are what the token is delimited by, so a name carrying one
// could otherwise end it early and put the rest of itself outside.
export const mentionName = (name: string): string =>
  name
    .replaceAll(/[[\]()\n\r]/gu, ' ')
    .trim()
    .slice(0, MAX_MENTION_NAME)

export const mentionToken = (name: string, target: string): string =>
  `@[${mentionName(name)}](mention:${target})`

export const everybodyToken = (): string => mentionToken(MENTION_EVERYBODY, MENTION_EVERYBODY)

export const mentionsIn = (body: string): Mention[] => {
  const found = new Map<string, Mention>()

  for (const [, name = '', target = ''] of body.matchAll(pattern())) {
    if (!found.has(target)) found.set(target, { name, target })
  }

  return [...found.values()]
}

export const mentionedAccounts = (body: string): string[] =>
  mentionsIn(body).flatMap(({ target }) => (target === MENTION_EVERYBODY ? [] : [target]))

export const mentionsEverybody = (body: string): boolean =>
  mentionsIn(body).some(({ target }) => target === MENTION_EVERYBODY)

/** Rewrites each token's display name from whoever the caller can resolve, at read time. */
export const withMentionNames = (body: string, nameOf: (target: string) => string | undefined): string =>
  body.replaceAll(pattern(), (whole, name: string, target: string) => {
    const now = target === MENTION_EVERYBODY ? MENTION_EVERYBODY : nameOf(target)

    return now === undefined ? whole : mentionToken(now, target)
  })

/**
 * `@[Ada](mention:a-1)` becomes `[@Ada](/members/a-1)`, which the markdown renderer then
 * escapes like any other link. A token left unconverted renders as its own text, since
 * `mention:` is not an allowed scheme — so the failure mode is a plain `@Ada`.
 */
export const mentionsAsLinks = (body: string): string =>
  body.replaceAll(pattern(), (_whole, name: string, target: string) =>
    target === MENTION_EVERYBODY
      ? `**@${mentionName(name)}**`
      : `[@${mentionName(name)}](${profilePage(target)})`,
  )
