import { eq } from 'drizzle-orm'

import type { Database } from '../db/index.ts'
import type { EmailChannel } from '../push/notify.ts'
import type { MailDeps, Posted } from './mail.ts'

import { account, installation, INSTALLATION_ID } from '../db/schema.ts'
import { mailSettingsFor, post, reasonFor } from './mail.ts'
import { absolute, notificationMessage } from './messages.ts'

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
    try {
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
