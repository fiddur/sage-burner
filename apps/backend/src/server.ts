import { createApp } from './app.ts'
import { createConfig } from './config.ts'
import { createDb, runMigrations } from './db/index.ts'
import { announceDeploy } from './push/deploy.ts'
import { recordAndPush } from './push/notify.ts'
import { DEFAULT_PUSH_CONTACT, deliverWithWebPush, generateVAPIDKeys } from './push/web-push.ts'

const config = createConfig()
const handle = createDb({ url: config.database_url })

runMigrations(handle)

const app = await createApp({ db: handle.db, config })

await announceDeploy(
  handle.db,
  config.build_sha,
  recordAndPush(
    { db: handle.db, deliver: deliverWithWebPush(DEFAULT_PUSH_CONTACT), mintKeys: generateVAPIDKeys },
    () => new Date(),
    (counts) => {
      app.log.warn({ ...counts }, 'announcing a deploy')
    },
  ),
).catch((failure: unknown) => {
  app.log.error({ err: failure }, 'could not announce the deploy')
})

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
