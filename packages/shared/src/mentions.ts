import { profilePage } from './pages.ts'

export const MENTION_EVERYBODY = 'everybody'

export const MAX_MENTION_NAME = 80

export interface Mention {
  name: string
  target: string
}

const MAX_TARGET = 64

// A new instance per call: a shared `gu` regex carries `lastIndex` between them.
const pattern = () =>
  new RegExp(`@\\[([^\\][\\n]{1,${MAX_MENTION_NAME}})\\]\\(mention:([\\w-]{1,${MAX_TARGET}})\\)`, 'gu')

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

export const withMentionNames = (body: string, nameOf: (target: string) => string | undefined): string =>
  body.replaceAll(pattern(), (whole, name: string, target: string) => {
    const now = target === MENTION_EVERYBODY ? MENTION_EVERYBODY : nameOf(target)

    return now === undefined ? whole : mentionToken(now, target)
  })

export const mentionsAsLinks = (body: string): string =>
  body.replaceAll(pattern(), (_whole, name: string, target: string) =>
    target === MENTION_EVERYBODY
      ? `**@${mentionName(name)}**`
      : `[@${mentionName(name)}](${profilePage(target)})`,
  )
