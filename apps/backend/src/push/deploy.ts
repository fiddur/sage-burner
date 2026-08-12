import { changelogPage } from '@sage-burner/shared'
import { eq } from 'drizzle-orm'

import type { Database } from '../db/index.ts'
import type { Notifier } from './notify.ts'

import { installation, INSTALLATION_ID } from '../db/schema.ts'
import { notifyEveryone } from './notify.ts'

// Called from `server.ts`, deliberately not from `createApp`: the suite builds an app per test,
// and a deploy announcement wired in there would fire hundreds of times.
export const announceDeploy = async (
  db: Database,
  buildSha: string,
  notify: Notifier,
): Promise<'announced' | 'first-boot' | 'unchanged'> => {
  const [row] = await db
    .select({ seen: installation.last_build_sha })
    .from(installation)
    .where(eq(installation.id, INSTALLATION_ID))
    .limit(1)

  if (row === undefined) return 'unchanged'
  if (row.seen === buildSha) return 'unchanged'

  if (buildSha === 'unknown') return 'unchanged'

  await db.update(installation).set({ last_build_sha: buildSha }).where(eq(installation.id, INSTALLATION_ID))

  if (row.seen === null) return 'first-boot'

  await notifyEveryone(db, notify, {
    category: 'new_version',
    body: 'A new version of the app is out. Reload to pick it up.',
    link: changelogPage(),
  })

  return 'announced'
}
