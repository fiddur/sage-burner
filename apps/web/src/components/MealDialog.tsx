import type { EventAttendeesResponse, Meal, MealUpdate } from '@sage-burner/shared'

import { MAX_OPTION_LABEL } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import { usePhone } from '../viewport.ts'
import { DreamPanel } from './DreamPanel.tsx'
import { HelperStrip } from './HelperStrip.tsx'
import { Icon } from './Icon.tsx'

type Person = EventAttendeesResponse['attendees'][number]

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
  const phone = usePhone()
  const [renaming, setRenaming] = useState(false)
  const [label, setLabel] = useState(meal.label)
  const [idea, setIdea] = useState(meal.food_idea)

  return (
    <DreamPanel
      label={meal.label}
      error={error}
      page={phone}
      askBeforeClosing={renaming ? 'Throw this renaming away?' : undefined}
      onClose={onClose}
    >
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
            <Icon name="edit" /> Rename
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

      {(meal.kind !== 'chore' || meal.lead !== null) && (
        <>
          <h3>Meal lead</h3>
          <HelperStrip
            label={meal.label}
            people={meal.lead === null ? [] : [meal.lead]}
            max={1}
            candidates={attendees}
            shut={meal.kind === 'chore'}
            everyone={attendees}
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

      <p class="form-note">
        The whole plan is on <a href="/meals">Meals</a>.
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
  joinable: boolean
  onStand: (role: 'cleanup' | 'helper', joining: boolean, accountId: string) => void
}) => (
  <>
    <h3>{role === 'helper' ? 'Helping cook' : 'Washing up'}</h3>
    <HelperStrip
      label={`${role === 'helper' ? 'cooking' : 'cleanup'} at ${meal.label}`}
      people={role === 'helper' ? meal.helpers : meal.cleanup}
      candidates={attendees.filter((who) => role === 'cleanup' || who.account_id !== meal.lead?.account_id)}
      shut={!joinable}
      everyone={attendees}
      viewerId={viewerId}
      busy={busy}
      onAdd={(accountId) => onStand(role, true, accountId)}
      onRemove={(accountId) => onStand(role, false, accountId)}
    />
  </>
)
