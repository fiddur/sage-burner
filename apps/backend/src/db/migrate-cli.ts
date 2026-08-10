import { createDb } from './client.ts'
import { runMigrations } from './migrate.ts'

const url = process.env.DATABASE_URL || './data/sage-burner.sqlite'
const handle = createDb({ url })

try {
  runMigrations(handle)
  console.info(`✅ Migrations applied to ${url}`)
} finally {
  handle.close()
}
