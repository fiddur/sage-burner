import { eq } from 'drizzle-orm'

import type { Database } from '../db/index.ts'
import type { EmailChannel } from '../push/notify.ts'
import type { MailDeps, Posted } from './mail.ts'

import { account, installation, INSTALLATION_ID } from '../db/schema.ts'
import { mailSettingsFor, post, reasonFor } from './mail.ts'
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

export interface ChannelDeps extends MailDeps {
  /**
   * Where a link in an email can point.
   *
   * `PUBLIC_ORIGIN` and nothing else. An email is read outside the app, so a relative
   * path is no use — and unlike the share card, which is built inside a request and
   * can read `Host`, this runs from wherever a role was handed out. An installation
   * that has not named its address gets messages that say what happened and stop
   * there, which is why the README asks for one alongside email.
   */
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

/**
 * **Never throws**, which is the rule `post` already follows (#357). The queue this
 * runs on reports a failure rather than rethrowing it, so a throw here would be a
 * message lost with only the queue's own line about it — where a refused send carries
 * the server's reason, which is what somebody fixing it needs.
 *
 * The reads below are the only way it could: `post` answers a failed send rather than
 * throwing. Reported through the same `log` a refused send goes to, so a database that
 * has gone away is said out loud here rather than swallowed by the caller's guard.
 */
export const emailChannel = (deps: ChannelDeps): EmailChannel => {
  return async (accountId, told) => {
    try {
      // First, because nearly every installation has no mail server and the two reads
      // below would then be building a message nothing can post.
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
    } catch (failure) {
      const posted = { sent: false, reason: reasonFor(failure) }
      deps.log(posted, accountId)

      return posted
    }
  }
}
