import type { JSX } from 'preact'

export const IconButton = ({
  icon,
  busyIcon,
  busy = false,
  label,
  disabled,
  ...rest
}: {
  icon: string
  busyIcon?: string
  busy?: boolean
  label: string
} & Omit<JSX.IntrinsicElements['button'], 'children'>) => (
  <button
    type="button"
    class="link-button"
    aria-label={label}
    aria-busy={busy}
    disabled={busy || disabled === true}
    {...rest}
  >
    {busy ? (busyIcon ?? icon) : icon}
  </button>
)
