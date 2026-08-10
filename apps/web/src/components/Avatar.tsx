import { apiRoutes } from '@sage-burner/shared'

import { AVATAR_PIXELS } from '../avatar.ts'
import { initials } from '../initials.ts'

export const Avatar = ({
  accountId,
  name,
  avatar,
  size,
}: {
  accountId: string
  name: string | null
  avatar: string | null
  size?: string
}) => {
  const classes = size === undefined ? 'avatar' : `avatar ${size}`

  if (avatar === null) {
    return (
      <span class={classes}>
        <span aria-hidden="true">{initials(name)}</span>
      </span>
    )
  }

  return (
    <img
      class={classes}
      src={`${apiRoutes.accountAvatar.path(accountId)}?v=${encodeURIComponent(avatar)}`}
      alt=""
      width={AVATAR_PIXELS}
      height={AVATAR_PIXELS}
    />
  )
}
