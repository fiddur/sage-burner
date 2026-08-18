import { eq } from 'drizzle-orm'

import type { EmailChannel } from '../push/notify.ts'
import type { MailDeps, Posted } from './mail.ts'

import { account } from '../db/schema.ts'
import { installationTitle, mailSettingsFor, post, reasonFor } from './mail.ts'
import { absolute, notificationMessage } from './messages.ts'

export interface ChannelDeps extends MailDeps {
  origin?: string
  log: (posted: Posted, accountId: string) => void
}

export const emailChannel = (deps: ChannelDeps): EmailChannel => {
  return async (accountId, told) => {
    try {
      if ((await mailSettingsFor(deps.db)) === undefined) return

      const [who] = await deps.db
        .select({ email: account.email, name: account.name })
        .from(account)
        .where(eq(account.id, accountId))
        .limit(1)

      if (who === undefined) return

      const about = { installation: await installationTitle(deps.db), to: who.email, name: who.name }

      const posted = await post(
        deps,
        told.letter?.(about) ??
          notificationMessage({
            installation: about.installation,
            to: about.to,
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
