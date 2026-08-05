import type { EventAttendeesResponse, Meal, MealUpdate } from '@sage-burner/shared'

import { MAX_OPTION_LABEL } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import { DreamPanel } from './DreamPanel.tsx'

type Person = EventAttendeesResponse['attendees'][number]

const nameOf = (person: { name: string | null }) => person.name ?? 'Someone without a name yet'

/**
 * One sitting, opened from the kitchen lane.
 *
 * The dream panel's shell, and much of its shape: read it, take something on, change
 * what it is called. What it does not offer is dropping the sitting — that is
 * admin's, under Events, because it decides whether people get fed.
 */
export const MealDialog = ({
  meal,
  attendees,
  viewerId,
  busy,
  error,
  onClose,
  onLead,
  onStand,
  onIdea,
  onRename,
}: {
  meal: Meal
  attendees: readonly Person[]
  viewerId: string | undefined
  busy: boolean
  error: string | undefined
  onClose: () => void
  onLead: (accountId: string | null) => void
  onStand: (role: 'cleanup' | 'helper', joining: boolean) => void
  onIdea: (idea: string) => void
  onRename: (changes: MealUpdate) => void
}) => {
  const [renaming, setRenaming] = useState(false)
  const [label, setLabel] = useState(meal.label)
  const [idea, setIdea] = useState(meal.food_idea)

  // Nobody may be handed a chore's lead, so nobody is offered for it. Whoever is
  // already on one still gets an option, or the control would show blank.
  const offered = meal.kind === 'chore' ? [] : attendees

  return (
    <DreamPanel label={meal.label} error={error} onClose={onClose}>
      <h2>{meal.label}</h2>
      <p class="form-note">
        {meal.date} · {meal.at}
        {meal.kind === 'chore' && ' · no cooking'}
      </p>

      {renaming ? (
        <p class="row">
          <input
            type="text"
            maxLength={MAX_OPTION_LABEL}
            aria-label={`Name of ${meal.label}`}
            value={label}
            onInput={(inputEvent) => setLabel(inputEvent.currentTarget.value)}
          />
          <button
            type="button"
            disabled={busy || label.trim() === ''}
            onClick={() => {
              onRename({ label: label.trim() })
              setRenaming(false)
            }}
          >
            Save
          </button>
          <button type="button" class="link-button" disabled={busy} onClick={() => setRenaming(false)}>
            Cancel
          </button>
        </p>
      ) : (
        <p class="row">
          <button
            type="button"
            class="link-button"
            disabled={busy}
            aria-label={`Rename ${meal.label}`}
            onClick={() => setRenaming(true)}
          >
            ✏️ Rename
          </button>
          <span class="form-note">Drag it in the grid to move it.</span>
        </p>
      )}

      <label class="field">
        <span>Food idea</span>
        <input
          type="text"
          maxLength={MAX_OPTION_LABEL}
          aria-label={`Food idea for ${meal.label}`}
          placeholder="Not needed"
          disabled={busy}
          value={idea}
          onInput={(inputEvent) => setIdea(inputEvent.currentTarget.value)}
          onBlur={() => {
            if (idea !== meal.food_idea) onIdea(idea)
          }}
        />
      </label>

      {/*
        A chore has nobody cooking, so it offers no lead and no cooks — **unless one
        is still recorded** from before the slot became a chore. Then the control
        appears so they can get off, which is what the API allows: vacating and
        standing down stay open where handing over and joining are refused.

        The two are gated separately, deliberately. Tied together, a chore with
        leftover helpers showed a lead select whose only affirmative action answers
        400, and a chore with a lead and no helpers offered no way to vacate at all.
      */}
      {(meal.kind !== 'chore' || meal.lead !== null) && (
        <label class="field">
          <span>Meal lead</span>
          <select
            aria-label={`Lead for ${meal.label}`}
            disabled={busy}
            value={meal.lead?.account_id ?? ''}
            onChange={(changeEvent) => onLead(changeEvent.currentTarget.value || null)}
          >
            <option value="">Nobody yet</option>
            {meal.lead !== null &&
              !offered.some((who) => who.account_id === meal.lead?.account_id) && (
                // Whenever the list below does not hold them — because they have withdrawn,
                // or because this is a chore and the list is empty. Without it nothing
                // matches the control's value and it reads as vacant while somebody is
                // still on it.
                <option value={meal.lead.account_id} disabled>
                  {nameOf(meal.lead)}
                  {attendees.some((who) => who.account_id === meal.lead?.account_id)
                    ? ''
                    : ' — no longer coming'}
                </option>
              )}
            {offered.map((who) => (
              <option key={who.account_id} value={who.account_id}>
                {nameOf(who)}
              </option>
            ))}
          </select>
          {meal.kind === 'chore' && (
            <span class="form-note">Nothing is cooked here, so this can only be vacated.</span>
          )}
        </label>
      )}

      {(meal.kind !== 'chore' || meal.helpers.length > 0) && (
        <Crew
          meal={meal}
          role="helper"
          viewerId={viewerId}
          busy={busy}
          joinable={meal.kind !== 'chore'}
          onStand={onStand}
        />
      )}

      <Crew meal={meal} role="cleanup" viewerId={viewerId} busy={busy} joinable onStand={onStand} />

      <p class="row">
        <button type="button" class="link-button" onClick={onClose}>
          Close
        </button>
        <span class="form-note">
          The whole plan is on <a href="/meals">Meals</a>.
        </span>
      </p>
    </DreamPanel>
  )
}

const Crew = ({
  meal,
  role,
  viewerId,
  busy,
  joinable,
  onStand,
}: {
  meal: Meal
  role: 'cleanup' | 'helper'
  viewerId: string | undefined
  busy: boolean
  /** False for a chore's cooks: whoever is on it may leave, nobody new may join. */
  joinable: boolean
  onStand: (role: 'cleanup' | 'helper', joining: boolean) => void
}) => {
  const crew = role === 'helper' ? meal.helpers : meal.cleanup
  const standing = crew.some((who) => who.account_id === viewerId)
  const what = role === 'helper' ? 'cook' : 'clean up'

  return (
    <>
      <h3>{role === 'helper' ? 'Helping cook' : 'Washing up'}</h3>
      {crew.length === 0 ? (
        <p class="form-note">Nobody yet.</p>
      ) : (
        <ul class="meal-crew">
          {crew.map((who) => (
            <li key={who.account_id}>{nameOf(who)}</li>
          ))}
        </ul>
      )}
      {(joinable || standing) && (
        <p class="row">
          <button type="button" disabled={busy} onClick={() => onStand(role, !standing)}>
            {standing ? 'Not me after all' : `I can ${what}`}
          </button>
        </p>
      )}
    </>
  )
}
