import { useState } from 'preact/hooks'

import { IconButton } from './IconButton.tsx'

/**
 * 🗑️ that asks first (#209).
 *
 * One component rather than a flag each caller keeps: there were two copies, and they
 * had already drifted — the Dreams list, where hitting the wrong row is easiest, was
 * the one that did not ask. Both pages reach this through the panel now (#342), and
 * keeping the question here still means a caller that unmounts this drops it, which is
 * what the panel does when it swaps in the edit form (#208).
 */
export const WithdrawDream = ({
  title,
  busy,
  onWithdraw,
}: {
  title: string
  busy: boolean
  onWithdraw: () => void
}) => {
  const [asking, setAsking] = useState(false)

  if (!asking) {
    return (
      <IconButton icon="🗑️" label={`Withdraw ${title}`} disabled={busy} onClick={() => setAsking(true)} />
    )
  }

  return (
    <>
      <span class="form-note">Withdraw it? Its helpers and hearts go too.</span>
      <button type="button" disabled={busy} aria-label={`Really withdraw ${title}`} onClick={onWithdraw}>
        Withdraw it
      </button>
      <button type="button" class="link-button" disabled={busy} onClick={() => setAsking(false)}>
        Keep it
      </button>
    </>
  )
}
