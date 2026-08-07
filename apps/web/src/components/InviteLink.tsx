import type { Invite, InviteDelivery } from '@sage-burner/shared'

import { CopyButton } from './CopyButton.tsx'

/**
 * An invite link, shown once.
 *
 * Built from `window.location.origin` so the API needs no notion of its own
 * public URL — the page is served from the origin the link has to point at.
 */
const urlFor = (invite: Invite) => `${window.location.origin}/invite/${invite.token}`

/**
 * What to say about the copy that was emailed, if there was one (#327).
 *
 * Three cases and all three are legitimate. The page said "Send this link" for all of
 * them, which was wrong in both directions: an applicant got the link twice from two
 * people, or the send failed on a TLS misconfiguration and the admin never learned.
 *
 * The link is shown whichever way it went — a bounce is invisible to this app, and the
 * admin may still need it.
 */
const deliveryNote = (delivery: InviteDelivery) => {
  if (delivery === null) return 'Send this link — it is shown once and cannot be recovered afterwards.'
  if (delivery.sent) return `Emailed to ${delivery.to}. The link is here too, shown once.`

  // The reason goes last and nothing is appended to it. Most are already a sentence —
  // "No mail server has been set up.", "Set PUBLIC_ORIGIN." — so a full stop of our own
  // read as "up.. Send this link", while a raw driver message arrives without one and
  // needs no stop at the end of a line. Putting it after the instruction is what makes
  // both read: the admin's job first, the server's words quoted after it.
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
      {/* The URL above stays selectable by hand, which is what makes a copy that
          silently did nothing recoverable — this token is stored only as a digest
          and cannot be shown a second time. */}
      <CopyButton value={url} label="Copy link" />
    </p>
  )
}
