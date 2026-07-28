export type { CreateDbOptions, Database, DbHandle } from './client.ts'
export { createDb } from './client.ts'
export { migrationsFolder, runMigrations } from './migrate.ts'
export * as schema from './schema.ts'
