import type { JSX, RefObject } from 'preact'

import type { IconName } from './Icon.tsx'

import { Icon } from './Icon.tsx'

// A `ref` on a function component reaches Preact's own instance rather than the button, so
// whoever needs to move focus here has to be handed the element itself.
export const IconButton = ({
  icon,
  busyIcon,
  busy = false,
  label,
  disabled,
  buttonRef,
  ...rest
}: {
  icon: IconName
  busyIcon?: IconName
  busy?: boolean
  label: string
  buttonRef?: RefObject<HTMLButtonElement>
} & Omit<JSX.IntrinsicElements['button'], 'children'>) => (
  <button
    ref={buttonRef}
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
