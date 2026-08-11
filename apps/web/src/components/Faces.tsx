import type { Supporter } from '@sage-burner/shared'

import { profilePage } from '@sage-burner/shared'

import { Avatar } from './Avatar.tsx'
import { NAMELESS } from './PersonBadge.tsx'

export const Faces = ({ people }: { people: readonly Supporter[] }) => {
  if (people.length === 0) return null

  return (
    <span class="faces">
      {people.map((person) => {
        const who = person.name ?? NAMELESS

        return (
          <a key={person.account_id} class="face" title={who} href={profilePage(person.account_id)}>
            <Avatar
              accountId={person.account_id}
              name={person.name}
              avatar={person.avatar}
              size="dream-facilitator"
            />
            <span class="visually-hidden">{who}</span>
          </a>
        )
      })}
    </span>
  )
}
