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

/**
 * Addresses that mean "only this machine can reach it".
 *
 * The whole 127.0.0.0/8 block, not just 127.0.0.1 — `127.0.0.2` is equally
 * local and someone will eventually use it. An empty or unset HOST is not
 * loopback: Node then binds every interface, which is the case this exists to
 * catch.
 */
const isLoopbackHost = (host: string): boolean =>
  host === 'localhost' || host === '::1' || host === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(host)

/**
 * Whether a browser other than the developer's own could reach this process.
 *
 * One predicate, used by both the `SESSION_SECRET` requirement and the `Secure`
 * flag, so the two cannot drift apart — they answer the same question.
 *
 * Three signals, because the first two together still miss the deployment this
 * repository documents. `NODE_ENV` cannot answer it alone: it defaults to
 * `development` when unset. Nor can `HOST`, because **a reverse proxy in front
 * means the app binds loopback** — `pnpm start` or a systemd unit on
 * `127.0.0.1:3000` behind `docs/deploying.md`'s Apache vhost satisfies "not production"
 * and "loopback" both, and would have booted quietly on the development key
 * that is committed to this repository, serving a non-`Secure` cookie over
 * Apache's TLS.
 *
 * `WEB_ROOT` closes it. Setting it says "serve the built frontend", which is a
 * deployment by definition — Vite serves the frontend in development, so a dev
 * run never sets it. The one case that pays for this is building the frontend
 * and pointing a local backend at it; `docs/configuration.md`'s recipe passes a
 * secret, and that run *is* serving the built app, so being treated as a
 * deployment is right.
 */
const looksLikeDeployment = (nodeEnv: string, host: string, webRoot: string | undefined): boolean =>
  nodeEnv === 'production' || !isLoopbackHost(host) || webRoot !== undefined

export const envSchema = z.object({
  NODE_ENV: optional(z.enum(['development', 'test', 'production']).default('development')),
  PORT: optional(port.default(3000)),
  /**
   * Loopback by default; the image sets `0.0.0.0` explicitly.
   *
   * The default used to be `0.0.0.0` "so the container is reachable", which the
   * container never needed — the Dockerfile has always set it. So the permissive
   * default only ever applied to the runs nobody documented: a bare
   * `node src/server.ts`, a systemd unit, a compose file that drops the image's
   * environment. Those bound every interface *and* fell back to the published
   * development signing key, which is the pairing the check in `createConfig`
   * exists to refuse.
   *
   * Binding every interface is now something a deployment has to say out loud,
   * and saying it means bringing your own `SESSION_SECRET`.
   */
  HOST: optional(z.string().min(1).default('127.0.0.1')),
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
  /**
   * Where a browser reaches this installation, e.g. `https://burn.example.org`.
   *
   * Only passkeys read it, and what they need from it is a *stable* domain: a
   * WebAuthn credential belongs to one, and is invisible under any other. Left
   * unset, each ceremony takes the browser's own `Origin` — which works, and
   * which `auth/webauthn.ts` says exactly what it costs.
   */
  PUBLIC_ORIGIN: optional(z.url().optional()),
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
  /**
   * Whether the session cookie gets `Secure`.
   *
   * Decided here rather than at the cookie, so the policy has one home and the
   * cookie does not re-derive it from `NODE_ENV` — which is the mistake this
   * file spends a paragraph explaining, since `NODE_ENV` defaults to
   * `development` when unset. Exactly the same predicate as the
   * `SESSION_SECRET` requirement, `looksLikeDeployment`, so the two cannot drift.
   */
  secure_cookies: boolean
  port: number
  host: string
  database_url: string
  log_level: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'
  build_sha: string
  web_root?: string
  trust_proxy: boolean | number | string
  /** The origin passkeys are bound to, when the operator has named one. */
  public_origin?: string
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

  // Absent is a development convenience, and the check below decides when that
  // convenience is safe by asking the question that actually matters: **is this
  // reachable by anyone?**
  //
  // `NODE_ENV` alone could not answer it. It defaults to `development` when
  // unset, so a bare `node apps/backend/src/server.ts` — a systemd unit, a
  // hand-rolled deploy, a compose file that drops the image's NODE_ENV — would
  // bind `0.0.0.0` and sign sessions with the key below, which is committed to
  // a public repository, while also omitting `Secure`. `HOST` is the value that
  // knows whether anyone else can reach the process, so it is the one that
  // decides.
  //
  // The fallback therefore requires *both*: not production, and bound to
  // loopback. `HOST` defaults to loopback for the same reason, so the safe case
  // is the one you get by doing nothing and reaching the LAN is what you have to
  // ask for — at which point you bring your own secret.
  //
  // Forging a token also needs the target's `account.id`, a v4 UUID that is not
  // guessable — but that is incidental rather than designed, and it weakens the
  // moment a route returns another member's id, which the admin list will. Do
  // not read it as a second layer.
  //
  // The fixed value is the same for every dev run, so a restart does not
  // invalidate the session you were testing with.
  const session_secret = value.SESSION_SECRET ?? 'development-only-session-secret-not-for-production'

  if (value.SESSION_SECRET === undefined && looksLikeDeployment(value.NODE_ENV, value.HOST, value.WEB_ROOT)) {
    throw new Error(
      `Invalid environment configuration:\n  SESSION_SECRET: required for anything a browser other than yours can reach — production, a non-loopback HOST, or a set WEB_ROOT (got NODE_ENV=${value.NODE_ENV}, HOST=${value.HOST}, WEB_ROOT=${value.WEB_ROOT ?? '(unset)'}). 32+ characters; generate with \`openssl rand -base64 48\``,
    )
  }

  return {
    node_env: value.NODE_ENV,
    session_secret,
    session_ttl_seconds: value.SESSION_TTL_SECONDS,
    secure_cookies: looksLikeDeployment(value.NODE_ENV, value.HOST, value.WEB_ROOT),
    port: value.PORT,
    host: value.HOST,
    database_url: value.DATABASE_URL,
    log_level: value.LOG_LEVEL,
    build_sha: value.BUILD_SHA,
    trust_proxy,
    ...(value.WEB_ROOT === undefined ? {} : { web_root: value.WEB_ROOT }),
    ...(value.PUBLIC_ORIGIN === undefined ? {} : { public_origin: value.PUBLIC_ORIGIN }),
  }
}
