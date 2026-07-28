import { createDb } from './client.ts'
import { runMigrations } from './migrate.ts'

/**
 * Apply migrations to the configured database and exit.
 *
 * The server also migrates on boot, so this is for one-off use: inspecting a
 * volume, or preparing a database before starting anything.
 */
// `||`, not `??`: an empty DATABASE_URL should behave like an unset one. See
// the guard in createDb for what an empty string would otherwise do.
const url = process.env.DATABASE_URL || './data/sage-burner.sqlite'
const handle = createDb({ url })

try {
  runMigrations(handle)
  console.info(`✅ Migrations applied to ${url}`)
} finally {
  handle.close()
}
