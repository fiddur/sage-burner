import { createApp } from './app.ts'
import { createConfig } from './config.ts'
import { createDb, runMigrations } from './db/index.ts'
import { announceDeploy } from './push/deploy.ts'
import { recordAndPush } from './push/notify.ts'
import { deliverWithWebPush, DEFAULT_PUSH_CONTACT, generateVAPIDKeys } from './push/web-push.ts'

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

/**
 * Say the app has been redeployed, to whoever asked to hear it (#259).
 *
 * Here rather than inside `createApp` on purpose: the suite builds an app per test,
 * and this would fire in every one of them. The build sha is what makes a redeploy
 * different from a restart, and the first boot on a fresh database records without
 * announcing.
 *
 * After `listen` would be tidier to read and wrong to do: a member who reloads on the
 * strength of the notification should find the new version already serving.
 */
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
  // Never fatal. Nobody hearing about a release is a smaller problem than an
  // installation that will not boot because a push service was unreachable.
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
