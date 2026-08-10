import { profilePage } from '@sage-burner/shared'

import { Avatar } from './Avatar.tsx'

export const PersonCell = ({
  accountId,
  name,
  avatar,
  waiting,
  under,
}: {
  accountId: string
  name: string
  avatar: string | null
  waiting: boolean
  under: string
}) => (
  <div class="person-cell">
    <Avatar accountId={accountId} name={name} avatar={avatar} size="person-cell-face" />
    <div>
      <a href={profilePage(accountId)}>{name}</a>
      {waiting && <span class="form-note"> · waiting</span>}
      <br />
      <span class="form-note">{under}</span>
    </div>
  </div>
)
