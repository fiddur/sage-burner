import { membersPage } from '@sage-burner/shared'
import { useLocation } from 'preact-iso'
import { useState } from 'preact/hooks'

import type { PaymentDueStore } from '../payment-due.ts'

import { useSelectedBurn } from '../burn.tsx'
import { hiddenPaymentDue, hidePaymentDue } from '../payment-due.ts'
import { isApproved, useViewer } from '../viewer.tsx'

export const PaymentDue = ({
  store,
  now = () => new Date(),
}: {
  store?: PaymentDueStore
  now?: () => Date
}) => {
  const viewer = useViewer()
  const burn = useSelectedBurn()
  const { path } = useLocation()
  const [hidden, setHidden] = useState(() => hiddenPaymentDue(store, now()))

  if (hidden || !isApproved(viewer) || path === membersPage()) return null
  if (burn?.attendance == null || burn.attendance.payment_status === 'paid') return null

  return (
    <p class="payment-due" role="status">
      <span>
        To secure your spot, your membership fee needs to be paid. See the{' '}
        <a href={membersPage(burn.event.id)}>members page</a> for instructions.
      </span>
      <button
        type="button"
        class="link-button"
        onClick={() => {
          hidePaymentDue(store, now())
          setHidden(true)
        }}
      >
        Hide for today
      </button>
    </p>
  )
}
