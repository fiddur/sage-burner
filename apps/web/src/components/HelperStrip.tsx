import { useState } from 'preact/hooks'

export interface Person {
  account_id: string
  name: string | null
}

const nameOf = (person: Person) => person.name ?? 'Someone without a name yet'

/**
 * Everywhere several people put their hands up for the same thing (#247).
 *
 * One control for a dream's helpers, a meal's crew and a lead role's team, because
 * they are one gesture. A vertical list: whoever is on it, then what is still
 * **wanted**, so the vacancies are as visible as the people.
 *
 * The two buttons sit on the **first** empty row only. Slots are interchangeable —
 * there is no sense in which the fourth is a different job from the second — so one
 * pair of controls fills the next free place and the rows below are pure count.
 *
 * 🙋 takes the spot and is always you; 👉 appoints somebody else, and is a step
 * further away because they are told about it. `candidates` is whoever may be
 * appointed, already filtered by the caller — a meal's cooking excludes its lead,
 * a dream's helpers exclude its facilitator — and that same list decides whether 🙋
 * is offered at all, since somebody who could not be appointed cannot volunteer
 * either.
 *
 * A vacancy row always exists even when the count is met, because the offer outlives
 * the count: a pair of hands is not a bed, which is the lodging list's rule and
 * deliberately not this one. That last row carries the buttons without the word
 * "wanted" — nothing more is asked for, but the offer stands.
 */
export const HelperStrip = ({
  label,
  people,
  wanted,
  max,
  candidates,
  viewerId,
  busy,
  onAdd,
  onRemove,
}: {
  /** What this group is called, for the labels a screen reader reads out. */
  label: string
  people: readonly Person[]
  /** How many are asked for. Absent where nobody counts — a dream's helpers. */
  wanted?: number
  /**
   * How many may hold it at once. `1` for a lead or a facilitator, where a filled
   * spot offers only ✕ — handing over is unassign then assign, two steps, and each
   * tells the person it happened to. Absent where any number of hands is welcome.
   */
  max?: number
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
  const canBeMe = !mine && viewerId !== undefined && candidates.some((who) => who.account_id === viewerId)
  const offerable = candidates.filter((who) => !on.has(who.account_id) && who.account_id !== viewerId)

  // At least one, so there is somewhere to put the buttons. The extra one is not
  // "wanted" — nothing more is asked for there. Where `max` says how many may hold
  // it, a full spot gets none at all: the only way on is through somebody's ✕.
  const short = Math.max(0, (wanted ?? 0) - people.length)
  const vacancies = max === undefined ? Math.max(short, 1) : Math.max(0, max - people.length)

  return (
    <ul class="helpers">
      {people.map((person) => (
        <li key={person.account_id} class="helper-taken">
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
