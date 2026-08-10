import { profilePage } from '@sage-burner/shared'

import { Avatar } from './Avatar.tsx'

export const NAMELESS = 'Someone without a name yet'

export const PersonBadge = ({
  accountId,
  name,
  avatar,
}: {
  accountId: string
  name: string | null
  avatar: string | null
}) => (
  <a class="person-badge" href={profilePage(accountId)}>
    <Avatar accountId={accountId} name={name} avatar={avatar} size="person-badge-face" />
    <span>{name ?? NAMELESS}</span>
  </a>
)
