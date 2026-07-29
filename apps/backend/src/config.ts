import proxyAddr from '@fastify/proxy-addr'
import { z } from 'zod'

/**
 * Runtime configuration, parsed from the environment exactly once at boot.
 *
 * Parsing is a pure function of an env object rather than reading
 * `process.env` directly, so tests can hand it whatever they like and there is
 * no module-level state to reset between them.
 */

const DEFAULT_DATABASE_URL = './data/sage-burner.sqlite'

/**
 * `''` is treated as absent throughout.
 *
 * `DATABASE_URL: ${DATABASE_URL}` in a compose file with the variable unset
 * expands to an empty string rather than nothing, so without this the empty
 * value would beat every default here — which for the database url means
 * opening a throwaway database and losing everything at shutdown.
 */
const blankToUndefined = (value: unknown) => {
  if (typeof value !== 'string') return value
  // Trim every string value, not just to decide blankness: an env file can
  // leave a trailing newline on any of them, and `HOST="127.0.0.1\n"` passes
  // validation, reaches `dns.lookup`, and fails the boot with an ENOTFOUND
  // naming a host that looks perfectly correct in the logs.
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

const optional = <T extends z.ZodType>(schema: T) => z.preprocess(blankToUndefined, schema)

const port = z.coerce.number().int().min(1).max(65_535)

/**
 * How much of `X-Forwarded-For` to believe.
 *
 * `true` trusts the entire chain from whoever connects, which makes
 * `request.ip` and `request.protocol` client-controlled unless something in
 * front always rewrites those headers — and nothing here guarantees that, since
 * the container runs one process with no proxy inside it. Default is therefore
 * to trust nothing; the operator states what is actually in front.
 *
 * `1` (a hop count) is the right answer behind a single reverse proxy.
 */
const parseTrustProxy = (value: string | undefined): boolean | number | string => {
  if (value === undefined) return false
  if (value === 'true') return true
  if (value === 'false') return false
  if (/^\d+$/.test(value)) return Number(value)

  // Anything else is an address or CIDR list, validated here so `TRUE`, `yes`,
  // or a fat-fingered CIDR is reported among the other configuration problems
  // rather than surfacing later as a bare `invalid IP address: TRUE` thrown
  // from inside Fastify().
  //
  // Imported from `@fastify/proxy-addr` specifically — Fastify 5 uses that
  // fork, not the original `proxy-addr`. They agree today, but they are
  // separately versioned, and this is the value that decides whether
  // `request.ip` is client-controlled: what we validate and what Fastify
  // enforces must be the same code, not merely two packages that currently
  // behave alike.
  //
  // Fastify splits and trims the raw string itself before compiling, so the
  // value passed through below is handled identically at runtime.
  proxyAddr.compile(value.split(',').map((entry) => entry.trim()))
  return value
}

export const envSchema = z.object({
  NODE_ENV: optional(z.enum(['development', 'test', 'production']).default('development')),
  PORT: optional(port.default(3000)),
  /** 0.0.0.0 so the container is reachable from outside it. */
  HOST: optional(z.string().min(1).default('0.0.0.0')),
  DATABASE_URL: optional(z.string().min(1).default(DEFAULT_DATABASE_URL)),
  LOG_LEVEL: optional(z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info')),
  /** Commit the image was built from. Surfaced by `/api/version`. */
  BUILD_SHA: optional(z.string().min(1).default('unknown')),
  /**
   * Directory holding the built web app.
   *
   * Absent in development, where Vite serves the frontend itself and proxies
   * `/api` here. Set in the container, where one Node process serves both.
   */
  WEB_ROOT: optional(z.string().min(1).optional()),
  /** `false` (default), `true`, a hop count like `1`, or an address/CIDR list. */
  TRUST_PROXY: optional(z.string().min(1).optional()),
  /**
   * HMAC key for session cookies.
   *
   * Optional here and required in production by the explicit check in
   * `createConfig` — not a Zod refinement, which could not tell the two
   * environments apart from inside this schema. A development run should not
   * need a secret to start, and a production one must not start without it.
   * Generating a random default at boot instead
   * would look like it works and silently log every member out on each deploy —
   * which, with watchtower redeploying on a tag move, is every few minutes
   * after a merge.
   */
  SESSION_SECRET: optional(z.string().min(32).optional()),
  /** How long a session lasts. Two weeks by default. */
  SESSION_TTL_SECONDS: optional(
    z.coerce
      .number()
      .int()
      .positive()
      .default(60 * 60 * 24 * 14),
  ),
})

export interface Config {
  node_env: 'development' | 'test' | 'production'
  session_secret: string
  session_ttl_seconds: number
  port: number
  host: string
  database_url: string
  log_level: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'
  build_sha: string
  web_root?: string
  trust_proxy: boolean | number | string
}

/**
 * Parse and validate the environment, or throw with every problem listed.
 *
 * Failing at boot is the point: a container that will not start is far easier
 * to diagnose than one that starts and behaves subtly wrong.
 */
export const createConfig = (env: NodeJS.ProcessEnv = process.env): Config => {
  const parsed = envSchema.safeParse(env)

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')
    throw new Error(`Invalid environment configuration:\n${problems}`)
  }

  const value = parsed.data

  let trust_proxy: boolean | number | string
  try {
    trust_proxy = parseTrustProxy(value.TRUST_PROXY)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid environment configuration:\n  TRUST_PROXY: ${detail}`)
  }

  // Absent outside production is a development convenience. The check below
  // rejects it in production — but note what that check is shaped like: it asks
  // `NODE_ENV === 'production'`, not "is this reachable by anyone". Any run that
  // is not that — bare-metal `node`, a systemd unit, a compose file overriding
  // NODE_ENV — signs sessions with the key three lines down, which is committed
  // to a public repository, and serves the cookie without `Secure` at the same
  // time. The image sets NODE_ENV=production, so the documented path is covered;
  // this is about the undocumented ones.
  //
  // Forging a token also needs the target's `account.id`, a v4 UUID that is not
  // guessable — but that is incidental rather than designed, and it weakens the
  // moment a route returns another member's id, which the admin list will. Do
  // not read it as a second layer.
  //
  // The fixed value is the same for every dev run, so a restart does not
  // invalidate the session you were testing with.
  const session_secret = value.SESSION_SECRET ?? 'development-only-session-secret-not-for-production'

  if (value.NODE_ENV === 'production' && value.SESSION_SECRET === undefined) {
    throw new Error(
      'Invalid environment configuration:\n  SESSION_SECRET: required in production (32+ characters; generate with `openssl rand -base64 48`)',
    )
  }

  return {
    node_env: value.NODE_ENV,
    session_secret,
    session_ttl_seconds: value.SESSION_TTL_SECONDS,
    port: value.PORT,
    host: value.HOST,
    database_url: value.DATABASE_URL,
    log_level: value.LOG_LEVEL,
    build_sha: value.BUILD_SHA,
    trust_proxy,
    ...(value.WEB_ROOT === undefined ? {} : { web_root: value.WEB_ROOT }),
  }
}
