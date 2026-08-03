import type { Invite } from '@sage-burner/shared'

import { useState } from 'preact/hooks'

/**
 * An invite link, shown once.
 *
 * Built from `window.location.origin` so the API needs no notion of its own
 * public URL — the page is served from the origin the link has to point at.
 */
const urlFor = (invite: Invite) => `${window.location.origin}/invite/${invite.token}`

export const InviteLink = ({ invite }: { invite: Invite | undefined }) => {
  const [copied, setCopied] = useState(false)

  if (invite === undefined) return null

  const url = urlFor(invite)

  return (
    <p class="form-note" role="status">
      Send this link — it is shown once and cannot be recovered afterwards. Expires{' '}
      {invite.expires_at.slice(0, 10)}.
      <br />
      <code>{url}</code>
      <br />
      <button
        type="button"
        class="link-button"
        onClick={() => {
          // Only on success. `writeText` rejects on a denied permission or an
          // unfocused document, and `navigator.clipboard` is undefined entirely
          // on a non-secure origin. For a token shown once and never shown
          // again (#91), a false "Copied" is how an organiser loses someone's
          // invite; the URL above stays selectable by hand.
          navigator.clipboard?.writeText(url).then(
            () => setCopied(true),
            () => undefined,
          )
        }}
      >
        {copied ? 'Copied' : 'Copy link'}
      </button>
    </p>
  )
}
