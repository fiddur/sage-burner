import { ensureAdmin } from '../auth/bootstrap.ts'
import { createDb } from '../db/client.ts'
import { runMigrations } from '../db/migrate.ts'

/**
 * Create the first admin, or grant admin to an existing account.
 *
 * ```sh
 * read -rs -p 'Password: ' ADMIN_PASSWORD; echo
 * ADMIN_EMAIL=you@example.org ADMIN_PASSWORD="$ADMIN_PASSWORD" \
 *   pnpm --filter sage-burner-backend admin:create
 * ```
 *
 * Both values come from the environment, never from `argv`: arguments are
 * visible in `ps` to every user on the host and land in shell history, and the
 * first password is the one worth protecting most.
 *
 * Migrations run first so this works against an empty volume — the point is to
 * have an admin *before* anyone logs in, which may be before the server has
 * ever started.
 */
const email = process.env.ADMIN_EMAIL
const password = process.env.ADMIN_PASSWORD

if (email === undefined || email === '' || password === undefined || password === '') {
  console.error('❌ Set ADMIN_EMAIL and ADMIN_PASSWORD in the environment.')
  process.exit(2)
}

// `||`, not `??`: an empty DATABASE_URL should behave like an unset one, the
// same as in migrate-cli.
const url = process.env.DATABASE_URL || './data/sage-burner.sqlite'
const handle = createDb({ url })

try {
  runMigrations(handle)
  const result = await ensureAdmin({ db: handle.db, email, password })

  if (result.created) {
    console.info(`✅ Admin created: ${email}`)
  } else {
    console.info(`✅ ${email} already existed and is now an admin.`)
    console.info('ℹ️  Its password was left alone — this command never changes an existing one.')
  }
} catch (error) {
  console.error(`❌ ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  handle.close()
}
