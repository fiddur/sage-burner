import type { Invite, InviteDelivery } from '@sage-burner/shared'

import { invitePage } from '@sage-burner/shared'

import { CopyButton } from './CopyButton.tsx'

const urlFor = (invite: Invite) => `${window.location.origin}${invitePage(invite.token)}`

const deliveryNote = (delivery: InviteDelivery) => {
  if (delivery === null) return 'Send this link — it is shown once and cannot be recovered afterwards.'
  if (delivery.sent) return `Emailed to ${delivery.to}. The link is here too, shown once.`

  return `Not emailed. Send this link — it is shown once and cannot be recovered afterwards. Why: ${delivery.reason ?? 'the mail server refused it.'}`
}

export const InviteLink = ({
  invite,
  delivery = null,
}: {
  invite: Invite | undefined
  delivery?: InviteDelivery
}) => {
  if (invite === undefined) return null

  const url = urlFor(invite)

  return (
    <p class="form-note" role="status">
      {deliveryNote(delivery)} Expires {invite.expires_at.slice(0, 10)}.
      <br />
      <code>{url}</code>
      <br />
      <CopyButton value={url} label="Copy link" />
    </p>
  )
}
