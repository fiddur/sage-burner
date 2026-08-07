import { eq } from 'drizzle-orm'

import type { Database } from '../db/index.ts'
import type { Notifier } from './notify.ts'

import { INSTALLATION_ID, installation } from '../db/schema.ts'
import { notifyEveryone } from './notify.ts'

/**
 * Tell whoever asked that the app has been redeployed (#259).
 *
 * The one notification not caused by somebody doing something. Watchtower replaces
 * the container on every merge to `develop`, so a boot is the event — the build sha
 * this process was given, against the one the last boot recorded.
 *
 * **Called from `server.ts`, deliberately not from `createApp`.** The suite builds an
 * app per test, and a deploy announcement wired into that would fire hundreds of
 * times and have to be stubbed out everywhere. Here it is one call on the real entry
 * point, and this function is directly testable without one.
 *
 * The first boot on a fresh database records and says nothing. There is no previous
 * version for it to be new against, and announcing one at install would greet the
 * first admin with news about an app they have just put there.
 *
 * `unknown` is what `config.ts` defaults `BUILD_SHA` to — a local `pnpm start`, or an
 * image built without the arg. Recorded like any other, so a real sha arriving after
 * one is a genuine change and announces itself; what it cannot do is announce the
 * transition *to* `unknown`, which is a build going backwards rather than a deploy.
 */
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

  // An `unknown` build is not recorded, which is stronger than merely not announcing
  // it. Recording it would make the *next* boot a change — so a local `pnpm start`
  // against the live volume, followed by the container coming back on the build it
  // was already running, would announce a version nobody deployed.
  if (buildSha === 'unknown') return 'unchanged'

  await db.update(installation).set({ last_build_sha: buildSha }).where(eq(installation.id, INSTALLATION_ID))

  if (row.seen === null) return 'first-boot'

  await notifyEveryone(db, notify, {
    category: 'new_version',
    body: 'A new version of the app is out. Reload to pick it up.',
    // No page of its own: the change is everywhere, and sending somebody to one
    // screen would say something about the release that is not known here.
    link: null,
  })

  return 'announced'
}
