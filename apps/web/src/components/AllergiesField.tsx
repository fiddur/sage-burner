import type { AllergyItem } from '@sage-burner/shared'

import { MAX_NOTES } from '@sage-burner/shared'

import { rowsFor } from '../textarea.ts'

export const AllergiesField = ({
  items,
  ticked,
  notes,
  onTicked,
  onNotes,
}: {
  items: readonly AllergyItem[]
  ticked: readonly string[]
  notes: string
  onTicked: (next: readonly string[]) => void
  onNotes: (next: string) => void
}) => (
  <>
    {items.length > 0 && (
      <fieldset class="field">
        <legend>Allergies or food you cannot eat</legend>
        {items.map((item) => (
          <label key={item.id} class="field-inline">
            <input
              type="checkbox"
              checked={ticked.includes(item.id)}
              onChange={(changed) =>
                onTicked(
                  changed.currentTarget.checked
                    ? [...ticked, item.id]
                    : ticked.filter((id) => id !== item.id),
                )
              }
            />
            <span>{item.label}</span>
          </label>
        ))}
      </fieldset>
    )}

    <label class="field">
      <span>{items.length > 0 ? 'Anything else you cannot eat' : 'Allergies or food you cannot eat'}</span>
      <textarea
        name="allergies_notes"
        maxLength={MAX_NOTES}
        rows={rowsFor(notes)}
        value={notes}
        onInput={(typed) => onNotes(typed.currentTarget.value)}
      />
    </label>
  </>
)
