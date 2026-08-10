import type { JSX } from 'preact'

export const PendingButton = ({
  busy,
  label,
  busyLabel,
  disabled,
  ...rest
}: {
  busy: boolean
  label: string
  busyLabel: string
} & Omit<JSX.IntrinsicElements['button'], 'children'>) => (
  <button {...rest} disabled={busy || disabled === true} aria-busy={busy}>
    {busy ? busyLabel : label}
  </button>
)
