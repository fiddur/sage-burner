import { useState } from 'preact/hooks'

import { IconButton } from './IconButton.tsx'
import { NAMELESS, PersonBadge } from './PersonBadge.tsx'

export interface Person {
  account_id: string
  name: string | null
}

export interface Face {
  account_id: string
  avatar: string | null
}

const nameOf = (person: Person) => person.name ?? NAMELESS

export const HelperStrip = ({
  label,
  people,
  wanted,
  max,
  candidates,
  everyone,
  viewerId,
  busy,
  onAdd,
  onRemove,
}: {
  label: string
  people: readonly Person[]
  wanted?: number
  max?: number
  candidates: readonly Person[]
  everyone: readonly Face[]
  viewerId: string | undefined
  busy: boolean
  onAdd: (accountId: string) => void
  onRemove: (accountId: string) => void
}) => {
  const [picking, setPicking] = useState(false)
  const [chosen, setChosen] = useState('')

  const on = new Set(people.map((person) => person.account_id))
  const mine = viewerId !== undefined && on.has(viewerId)
  const canBeMe = !mine && viewerId !== undefined && candidates.some((who) => who.account_id === viewerId)
  const offerable = candidates.filter((who) => !on.has(who.account_id) && who.account_id !== viewerId)

  const short = Math.max(0, (wanted ?? 0) - people.length)
  const vacancies = max === undefined ? Math.max(short, 1) : Math.max(0, max - people.length)

  return (
    <ul class="helpers">
      {people.map((person) => (
        <li key={person.account_id} class="helper-taken">
          <PersonBadge
            accountId={person.account_id}
            name={person.name}
            avatar={everyone.find((who) => who.account_id === person.account_id)?.avatar ?? null}
          />
          <IconButton
            icon="✕"
            label={`Take ${nameOf(person)} off ${label}`}
            disabled={busy}
            onClick={() => onRemove(person.account_id)}
          />
        </li>
      ))}

      {Array.from({ length: vacancies }, (_, at) => (
        <li key={`vacancy-${at}`} class="helper-vacancy">
          <span class="form-note">{at < short ? 'wanted' : ''}</span>

          {at === 0 && (
            <span class="helper-actions">
              {canBeMe && viewerId !== undefined && (
                <button
                  type="button"
                  disabled={busy}
                  title="Take the spot"
                  aria-label={`Take the spot on ${label}`}
                  onClick={() => onAdd(viewerId)}
                >
                  🙋
                </button>
              )}
              {offerable.length > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  title="Appoint someone"
                  aria-label={`Appoint someone to ${label}`}
                  aria-expanded={picking}
                  onClick={() => setPicking(!picking)}
                >
                  👉
                </button>
              )}
            </span>
          )}
        </li>
      ))}

      {picking && offerable.length > 0 && (
        <li class="helper-picker">
          <select
            aria-label={`Who to appoint to ${label}`}
            disabled={busy}
            value={chosen}
            onChange={(changeEvent) => setChosen(changeEvent.currentTarget.value)}
          >
            <option value="">Choose somebody</option>
            {[...offerable]
              .sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
              .map((person) => (
                <option key={person.account_id} value={person.account_id}>
                  {nameOf(person)}
                </option>
              ))}
          </select>
          <button
            type="button"
            disabled={busy || chosen === ''}
            onClick={() => {
              onAdd(chosen)
              setChosen('')
              setPicking(false)
            }}
          >
            Appoint
          </button>
        </li>
      )}
    </ul>
  )
}
