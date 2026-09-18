import { readFileSync } from 'node:fs'

import { createDb } from '../db/client.ts'
import { runMigrations } from '../db/migrate.ts'
import { importPantry, readPantryTsv } from '../pantry-import.ts'
import { pantryPlacesFor } from '../pantry-places.ts'

const [file] = process.argv.slice(2)

if (file === undefined || file === '') {
  console.error('❌ Name a tab-separated file: pnpm --filter sage-burner-backend pantry:import <file.tsv>')
  process.exit(2)
}

let text: string
try {
  text = readFileSync(file, 'utf8')
} catch (error) {
  console.error(`❌ ${error instanceof Error ? error.message : String(error)}`)
  process.exit(2)
}

const url = process.env.DATABASE_URL || './data/sage-burner.sqlite'
const handle = createDb({ url })

try {
  runMigrations(handle)

  const reading = readPantryTsv(text, await pantryPlacesFor(handle.db))

  if (reading.kind === 'bad') {
    console.error(`❌ ${reading.problem}`)
    process.exit(2)
  }

  const { added, updated } = await importPantry(handle.db, reading, () => new Date())

  console.info(`✅ ${added} added, ${updated} updated. Nothing counted was touched.`)
} catch (error) {
  console.error(`❌ ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  handle.close()
}
