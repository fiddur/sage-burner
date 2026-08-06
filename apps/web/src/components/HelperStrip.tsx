import { useState } from 'preact/hooks'

export interface Person {
  account_id: string
  name: string | null
}

const nameOf = (person: Person) => person.name ?? 'Someone without a name yet'

/**
 * `Me — Ada` first, then the rest by name.
 *
 * Yourself is the most common answer and the one that should not need reading;
 * alphabetical is what makes the second most common one work, since you know the
 * name of whoever you are handing it to. Bare `Me` for somebody who has not filled
 * a name in, because `Me — Someone without a name yet` reads as a bug.
 */
export const meFirst = (people: readonly Person[], viewerId: string | undefined): readonly Person[] => {
  const rest = [...people]
    .filter((person) => person.account_id !== viewerId)
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
  const me = people.find((person) => person.account_id === viewerId)

  return me === undefined ? rest : [{ ...me, name: me.name === null ? 'Me' : `Me — ${me.name}` }, ...rest]
}

/**
 * Everywhere several people put their hands up for the same thing (#247).
 *
 * One control for a dream's helpers, a meal's crew and a lead role's team, because
 * they are one gesture. Whoever is on it is a chip; what is still **wanted** is a
 * ghost slot, so the count is an affordance rather than a sentence beside one.
 *
 * 🙋 is always you, and it is the whole of the common case. Naming somebody else is
 * deliberately one step further away, behind `＋`: putting your own hand up should be
 * free, and putting up somebody else's should take a moment — they are told about it.
 *
 * A ghost is never a refusal. Slots run out and the offer does not: a pair of hands
 * is not a bed, which is the rule the lodging list has and this deliberately does not.
 */
export const HelperStrip = ({
  label,
  people,
  wanted,
  candidates,
  viewerId,
  busy,
  onAdd,
  onRemove,
}: {
  /** What this group is called where it sits — `Team`, `Helping`, `Cleanup`. */
  label: string
  people: readonly Person[]
  /** How many are asked for, when anybody has said. Ghost slots come from this. */
  wanted?: number
  candidates: readonly Person[]
  viewerId: string | undefined
  busy: boolean
  onAdd: (accountId: string) => void
  onRemove: (accountId: string) => void
}) => {
  const [picking, setPicking] = useState(false)
  const [chosen, setChosen] = useState('')

  const on = new Set(people.map((person) => person.account_id))
  const mine = viewerId !== undefined && on.has(viewerId)
  // Every one of these is held by an attendance, so somebody not coming to the burn
  // has nothing to put their hand up for — an organiser who holds `admin` alone sets
  // the register up without appearing in it.
  const canBeMe = viewerId !== undefined && candidates.some((person) => person.account_id === viewerId)
  const ghosts = Math.max(0, (wanted ?? 0) - people.length)
  const offerable = candidates.filter((person) => !on.has(person.account_id))

  return (
    <div class="helpers">
      <ul class="helper-chips">
        {people.map((person) => (
          <li key={person.account_id} class="helper-chip">
            <span>{nameOf(person)}</span>
            <button
              type="button"
              class="link-button"
              disabled={busy}
              aria-label={`Take ${nameOf(person)} off ${label}`}
              onClick={() => onRemove(person.account_id)}
            >
              ✕
            </button>
          </li>
        ))}

        {/* One per place still wanted, and one more when none is — 🙋 has to be
            offered whether or not anybody counted. */}
        {Array.from({ length: mine || !canBeMe ? ghosts : Math.max(ghosts, 1) }, (_, at) => (
          <li key={`slot-${at}`} class="helper-slot">
            {mine || !canBeMe || viewerId === undefined ? (
              <span class="form-note" aria-hidden="true">
                🙋
              </span>
            ) : (
              <button
                type="button"
                disabled={busy}
                aria-label={`Put me on ${label}`}
                onClick={() => onAdd(viewerId)}
              >
                🙋
              </button>
            )}
          </li>
        ))}

        {offerable.length > 0 && (
          <li>
            <button
              type="button"
              class="link-button"
              disabled={busy}
              aria-label={`Put somebody else on ${label}`}
              aria-expanded={picking}
              onClick={() => setPicking(!picking)}
            >
              ＋
            </button>
          </li>
        )}
      </ul>

      {picking && offerable.length > 0 && (
        <p class="row">
          <select
            aria-label={`Who to put on ${label}`}
            disabled={busy}
            value={chosen}
            onChange={(changeEvent) => setChosen(changeEvent.currentTarget.value)}
          >
            <option value="">Choose somebody</option>
            {meFirst(offerable, viewerId).map((person) => (
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
            Add them
          </button>
        </p>
      )}

      {wanted !== undefined && wanted > 0 && (
        <p class="form-note helper-count">
          {people.length} of {wanted} wanted
        </p>
      )}
    </div>
  )
}
