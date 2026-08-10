import { ensureAdmin } from '../auth/bootstrap.ts'
import { createDb } from '../db/client.ts'
import { runMigrations } from '../db/migrate.ts'

const email = process.env.ADMIN_EMAIL
const password = process.env.ADMIN_PASSWORD

if (email === undefined || email === '' || password === undefined || password === '') {
  console.error('❌ Set ADMIN_EMAIL and ADMIN_PASSWORD in the environment.')
  process.exit(2)
}

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
