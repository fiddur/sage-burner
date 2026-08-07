import { useState } from 'preact/hooks'

/**
 * 🗑️ that asks first, on both pages a dream can be withdrawn from (#209).
 *
 * One component rather than a flag each caller keeps: the two copies had already
 * drifted, leaving the list — where hitting the wrong row is easiest — the one that
 * did not ask. Keeping the question here also means a caller that unmounts this drops
 * it, which is what the panel does when it swaps in the edit form (#208).
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
      <button
        type="button"
        class="link-button"
        disabled={busy}
        aria-label={`Withdraw ${title}`}
        onClick={() => setAsking(true)}
      >
        🗑️
      </button>
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
