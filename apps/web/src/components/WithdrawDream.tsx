import { Destroy } from './Destroy.tsx'

export const WithdrawDream = ({
  title,
  busy,
  onWithdraw,
}: {
  title: string
  busy: boolean
  onWithdraw: () => void
}) => (
  <Destroy
    what={title}
    verb="Withdraw"
    because="Its helpers and hearts go too."
    busy={busy}
    onDestroy={onWithdraw}
  />
)
