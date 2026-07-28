import { createApp } from './app.ts'
import { createConfig } from './config.ts'
import { createDb, runMigrations } from './db/index.ts'

/**
 * Entry point. Everything it does is sequencing — the pieces themselves are
 * testable without it.
 */
const config = createConfig()
const handle = createDb({ url: config.database_url })

// Before listening, not after: a fresh volume needs its schema, and a boot that
// cannot migrate should fail rather than serve against a half-built database.
runMigrations(handle)

const app = await createApp({ db: handle.db, config })

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down`)
  await app.close()
  handle.close()
  process.exit(0)
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    shutdown(signal).catch((error: unknown) => {
      app.log.error({ error }, 'failed to shut down cleanly')
      process.exit(1)
    })
  })
}

await app.listen({ port: config.port, host: config.host })
