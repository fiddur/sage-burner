import { eq } from 'drizzle-orm'

import type { Database } from '../db/index.ts'
import type { EmailChannel } from '../push/notify.ts'
import type { MailDeps, Posted } from './mail.ts'

import { account, INSTALLATION_ID, installation } from '../db/schema.ts'
import { mailSettingsFor, post } from './mail.ts'
import { absolute, notificationMessage } from './messages.ts'

/**
 * The email half of a notification, wired to what it needs (#30).
 *
 * Its own module rather than part of `notify.ts`, which knows about the bell and
 * about push and should not also learn the installation's name and where it posts
 * from. `app.ts` hands the result to `recordAndPush`, and an installation with no
 * SMTP server still gets one — the settings are read per message rather than at boot,
 * because an admin who sets them up should not have to restart the container.
 */

/**
 * Where a link in an email can point.
 *
 * `PUBLIC_ORIGIN` and nothing else. An email is read outside the app, so a relative
 * path is no use — and unlike the share card, which is built inside a request and can
 * read `Host`, this runs from wherever a role was handed out. An installation that
 * has not named its address gets messages that say what happened and stop there,
 * which is why the README asks for one alongside email.
 */
export interface ChannelDeps extends MailDeps {
  origin?: string
  log: (posted: Posted, accountId: string) => void
}

const titleOf = async (db: Database): Promise<string> => {
  const [row] = await db
    .select({ title: installation.title })
    .from(installation)
    .where(eq(installation.id, INSTALLATION_ID))
    .limit(1)

  return row?.title ?? ''
}

export const emailChannel = (deps: ChannelDeps): EmailChannel => {
  return async (accountId, told) => {
    // Before anything else, and cheap: nearly every installation has no mail server,
    // and the alternative is two more reads per notification to build a message
    // nothing can post.
    if ((await mailSettingsFor(deps.db)) === undefined) return

    const [who] = await deps.db
      .select({ email: account.email })
      .from(account)
      .where(eq(account.id, accountId))
      .limit(1)

    if (who === undefined) return

    const posted = await post(
      deps,
      notificationMessage({
        installation: await titleOf(deps.db),
        to: who.email,
        body: told.body,
        link: told.link === null ? undefined : absolute(deps.origin, told.link),
      }),
    )

    if (!posted.sent) deps.log(posted, accountId)

    return posted
  }
}
