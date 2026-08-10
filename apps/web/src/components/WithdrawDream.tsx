import { useState } from 'preact/hooks'

import { IconButton } from './IconButton.tsx'

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
