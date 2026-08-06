import type { Invite } from '@sage-burner/shared'

import { CopyButton } from './CopyButton.tsx'

/**
 * An invite link, shown once.
 *
 * Built from `window.location.origin` so the API needs no notion of its own
 * public URL — the page is served from the origin the link has to point at.
 */
const urlFor = (invite: Invite) => `${window.location.origin}/invite/${invite.token}`

export const InviteLink = ({ invite }: { invite: Invite | undefined }) => {
  if (invite === undefined) return null

  const url = urlFor(invite)

  return (
    <p class="form-note" role="status">
      Send this link — it is shown once and cannot be recovered afterwards. Expires{' '}
      {invite.expires_at.slice(0, 10)}.
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
