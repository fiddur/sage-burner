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
const blankToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value

const optional = <T extends z.ZodType>(schema: T) => z.preprocess(blankToUndefined, schema)

const port = z.coerce.number().int().min(1).max(65_535)

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
})

export type Env = z.infer<typeof envSchema>

export interface Config {
  node_env: 'development' | 'test' | 'production'
  port: number
  host: string
  database_url: string
  log_level: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'
  build_sha: string
  web_root?: string
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
    // Trimmed: `DATABASE_URL` sourced from an env file can carry a trailing
    // newline, which would create the directory and then open a file whose
    // name ends in one.
    database_url: value.DATABASE_URL.trim(),
    log_level: value.LOG_LEVEL,
    build_sha: value.BUILD_SHA,
    ...(value.WEB_ROOT === undefined ? {} : { web_root: value.WEB_ROOT.trim() }),
  }
}
