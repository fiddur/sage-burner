import type { Supporter } from '@sage-burner/shared'

import { useId, useState } from 'preact/hooks'

import { Avatar } from './Avatar.tsx'
import { PersonBadge } from './PersonBadge.tsx'

const STACKED = 3

const Stack = ({ people }: { people: readonly Supporter[] }) => (
  <span class="faces">
    {people.slice(0, STACKED).map((person) => (
      <span key={person.account_id} class="face">
        <Avatar
          accountId={person.account_id}
          name={person.name}
          avatar={person.avatar}
          size="dream-facilitator"
        />
      </span>
    ))}
  </span>
)

export const Heart = ({
  what,
  hearted,
  count,
  people = [],
  busy,
  onHeart,
}: {
  what: string
  hearted: boolean
  count: number
  people?: readonly Supporter[]
  busy: boolean
  onHeart: (hearting: boolean) => void
}) => {
  const [showing, setShowing] = useState(false)
  const listId = useId()

  return (
    <span class="heart-wrap">
      <button
        type="button"
        class="dream-heart"
        disabled={busy}
        aria-pressed={hearted}
        aria-label={`${hearted ? 'Take back your heart for' : 'Give a heart to'} ${what}`}
        onClick={(clickEvent) => {
          clickEvent.stopPropagation()
          onHeart(!hearted)
        }}
      >
        <span aria-hidden="true">{hearted ? '❤️‍🔥' : '♡'}</span>
      </button>

      {count > 0 && (
        <button
          type="button"
          class="heart-who-toggle"
          aria-expanded={showing}
          aria-controls={listId}
          onClick={(clickEvent) => {
            clickEvent.stopPropagation()
            setShowing(!showing)
          }}
        >
          <Stack people={people} />
          <span class="dream-heart-count">{count}</span>
          <span class="visually-hidden"> gave a heart to {what}</span>
        </button>
      )}

      {showing && (
        <ul id={listId} class="heart-who">
          {people.map((person) => (
            <li key={person.account_id}>
              <PersonBadge accountId={person.account_id} name={person.name} avatar={person.avatar} />
            </li>
          ))}
        </ul>
      )}
    </span>
  )
}
