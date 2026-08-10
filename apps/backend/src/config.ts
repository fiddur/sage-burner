import proxyAddr from '@fastify/proxy-addr'
import { z } from 'zod'

const DEFAULT_DATABASE_URL = './data/sage-burner.sqlite'

const blankToUndefined = (value: unknown) => {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

const optional = <T extends z.ZodType>(schema: T) => z.preprocess(blankToUndefined, schema)

const port = z.coerce.number().int().min(1).max(65_535)

const parseTrustProxy = (value: string | undefined): boolean | number | string => {
  if (value === undefined) return false
  if (value === 'true') return true
  if (value === 'false') return false
  if (/^\d+$/.test(value)) return Number(value)

  proxyAddr.compile(value.split(',').map((entry) => entry.trim()))
  return value
}

const isLoopbackHost = (host: string): boolean =>
  host === 'localhost' || host === '::1' || host === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(host)

const looksLikeDeployment = (nodeEnv: string, host: string, webRoot: string | undefined): boolean =>
  nodeEnv === 'production' || !isLoopbackHost(host) || webRoot !== undefined

export const envSchema = z.object({
  NODE_ENV: optional(z.enum(['development', 'test', 'production']).default('development')),
  PORT: optional(port.default(3000)),
  HOST: optional(z.string().min(1).default('127.0.0.1')),
  DATABASE_URL: optional(z.string().min(1).default(DEFAULT_DATABASE_URL)),
  LOG_LEVEL: optional(z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info')),
  BUILD_SHA: optional(z.string().min(1).default('unknown')),
  WEB_ROOT: optional(z.string().min(1).optional()),
  TRUST_PROXY: optional(z.string().min(1).optional()),
  SESSION_SECRET: optional(z.string().min(32).optional()),
  PUBLIC_ORIGIN: optional(
    z
      .url()
      .transform((configured) => new URL(configured).origin)
      .optional(),
  ),
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
  secure_cookies: boolean
  port: number
  host: string
  database_url: string
  log_level: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'
  build_sha: string
  web_root?: string
  trust_proxy: boolean | number | string
  public_origin?: string
}

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
