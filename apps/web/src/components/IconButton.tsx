import type { JSX } from 'preact'

import type { IconName } from './Icon.tsx'

import { Icon } from './Icon.tsx'

export const IconButton = ({
  icon,
  busyIcon,
  busy = false,
  label,
  disabled,
  ...rest
}: {
  icon: IconName
  busyIcon?: IconName
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
    <Icon name={busy ? (busyIcon ?? icon) : icon} />
  </button>
)
