import type { PushBrowser } from '../push.ts'
import type { NotificationSettingsApi } from './NotificationSettingsField.tsx'
import type { PushApi } from './PushHere.tsx'

import { useInstallationSendsEmail } from '../installation.tsx'
import { NotificationSettingsField } from './NotificationSettingsField.tsx'
import { PushAsk, usePushHere } from './PushHere.tsx'

export type PushToggleApi = PushApi & NotificationSettingsApi

export const PushToggle = ({ api, browser }: { api: PushToggleApi; browser?: PushBrowser | undefined }) => {
  const sendsEmail = useInstallationSendsEmail()
  const push = usePushHere(api, browser)

  return (
    <section>
      <h2>Notifications</h2>

      <PushAsk
        push={push}
        blurb="Tells you when somebody hands you a lead role or takes you off one — and, if you organise, when someone applies to join. Per browser, so turn it on anywhere you want to hear about it."
      />

      <h3>What to tell me about</h3>
      <NotificationSettingsField api={api} sendsEmail={sendsEmail === true} push={push} />
    </section>
  )
}
