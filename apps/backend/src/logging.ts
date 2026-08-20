import { apiRoutes, INVITE_PATTERN, RESET_PATTERN } from '@sage-burner/shared'

const prefixOf = (fastify: string): string => `${fastify.split('/:')[0] ?? fastify}/`

const CARRIES_A_TOKEN: readonly string[] = [
  prefixOf(apiRoutes.getPasswordResetState.fastify),
  prefixOf(apiRoutes.getInviteState.fastify),
  prefixOf(RESET_PATTERN),
  prefixOf(INVITE_PATTERN),
]

export const REDACTED = '[redacted]'

export const maskedUrl = (url: string): string => {
  const [path = url, ...rest] = url.split('?')

  for (const prefix of CARRIES_A_TOKEN) {
    if (!path.startsWith(prefix)) continue

    const [token, ...tail] = path.slice(prefix.length).split('/')
    if (token === undefined || token === '') continue

    return [`${prefix}${[REDACTED, ...tail].join('/')}`, ...rest].join('?')
  }

  return url
}

// A `type` and not an `interface`: fastify's serializer return has an index signature, and an
// interface does not get an implicit one, so this would not be assignable to it.
type Logged = {
  method?: string
  url?: string
  version?: string
  host?: string
  remoteAddress?: string
  remotePort?: number
}

const at = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined

const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

const whole = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined)

// Fastify types this as the raw `IncomingMessage` but passes its own request, so `ip` and
// `host` are not on the declared type — `unknown` and a reader rather than a cast.
export const requestSerializer = (request: unknown): Logged => {
  const url = text(at(request, 'url'))

  return {
    method: text(at(request, 'method')),
    url: url === undefined ? undefined : maskedUrl(url),
    version: text(at(at(request, 'headers'), 'accept-version')),
    host: text(at(request, 'host')),
    remoteAddress: text(at(request, 'ip')),
    remotePort: whole(at(at(request, 'socket'), 'remotePort')),
  }
}
