import type { EventAttendeesResponse, Meal, MealUpdate } from '@sage-burner/shared'

import { MAX_OPTION_LABEL } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import { DreamPanel } from './DreamPanel.tsx'
import { HelperStrip } from './HelperStrip.tsx'

type Person = EventAttendeesResponse['attendees'][number]

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
  onStand: (role: 'cleanup' | 'helper', joining: boolean, accountId: string) => void
  onIdea: (idea: string) => void
  onRename: (changes: MealUpdate) => void
}) => {
  const [renaming, setRenaming] = useState(false)
  const [label, setLabel] = useState(meal.label)
  const [idea, setIdea] = useState(meal.food_idea)

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
          placeholder="What's cooking?"
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
        <>
          <h3>Meal lead</h3>
          <HelperStrip
            label={meal.label}
            people={meal.lead === null ? [] : [meal.lead]}
            max={1}
            // A chore takes no new lead, so it offers nobody — whoever is still on one
            // keeps their ✕, which is what the API allows.
            candidates={meal.kind === 'chore' ? [] : attendees}
            viewerId={viewerId}
            busy={busy}
            onAdd={onLead}
            onRemove={() => onLead(null)}
          />
        </>
      )}

      {(meal.kind !== 'chore' || meal.helpers.length > 0) && (
        <Crew
          meal={meal}
          role="helper"
          attendees={attendees}
          viewerId={viewerId}
          busy={busy}
          joinable={meal.kind !== 'chore'}
          onStand={onStand}
        />
      )}

      <Crew
        meal={meal}
        role="cleanup"
        attendees={attendees}
        viewerId={viewerId}
        busy={busy}
        joinable
        onStand={onStand}
      />

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
  attendees,
  viewerId,
  busy,
  joinable,
  onStand,
}: {
  meal: Meal
  role: 'cleanup' | 'helper'
  attendees: readonly Person[]
  viewerId: string | undefined
  busy: boolean
  /** False for a chore's cooks: whoever is on it may leave, nobody new may join. */
  joinable: boolean
  onStand: (role: 'cleanup' | 'helper', joining: boolean, accountId: string) => void
}) => (
  <>
    <h3>{role === 'helper' ? 'Helping cook' : 'Washing up'}</h3>
    <HelperStrip
      label={`${role === 'helper' ? 'cooking' : 'cleanup'} at ${meal.label}`}
      people={role === 'helper' ? meal.helpers : meal.cleanup}
      // The lead is already cooking it, so they are not offered a second pair of
      // hands for the same thing — and may still wash up, which is why this is per
      // role. A chore's cooks take nobody at all.
      candidates={
        joinable
          ? attendees.filter((who) => role === 'cleanup' || who.account_id !== meal.lead?.account_id)
          : []
      }
      viewerId={viewerId}
      busy={busy}
      onAdd={(accountId) => onStand(role, true, accountId)}
      onRemove={(accountId) => onStand(role, false, accountId)}
    />
  </>
)
