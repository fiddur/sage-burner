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
  // Anything else is an address or CIDR list, which Fastify accepts verbatim.
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
})

export interface Config {
  node_env: 'development' | 'test' | 'production'
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

  return {
    node_env: value.NODE_ENV,
    port: value.PORT,
    host: value.HOST,
    database_url: value.DATABASE_URL,
    log_level: value.LOG_LEVEL,
    build_sha: value.BUILD_SHA,
    trust_proxy: parseTrustProxy(value.TRUST_PROXY),
    ...(value.WEB_ROOT === undefined ? {} : { web_root: value.WEB_ROOT }),
  }
}
