import { useState } from 'preact/hooks'

/**
 * 🗑️ that asks first, on both pages a dream can be withdrawn from (#209).
 *
 * The grid's panel asked and the list did not, so the same destructive act had two
 * levels of protection — and the weaker one was the list, where hitting the wrong row
 * is easiest. One component rather than a flag each caller keeps: two copies of the
 * dance had already drifted apart once.
 *
 * The question is this component's own state, so a caller that unmounts it drops the
 * question with it. That is what the panel does when it swaps the read view for the
 * edit form, and it is why nothing has to remember to clear the flag on the way
 * through (#208).
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
