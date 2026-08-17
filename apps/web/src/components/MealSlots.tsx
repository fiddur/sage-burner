import type { MealSlot, MealSlotKind } from '@sage-burner/shared'

import { MAX_OPTION_LABEL } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { useAction, useLoad } from '../load.ts'
import { Destroy } from './Destroy.tsx'
import { ErrorText } from './ErrorText.tsx'

export type MealSlotsApi = Pick<
  ApiClient,
  'getMealSlots' | 'addMealSlot' | 'updateMealSlot' | 'deleteMealSlot' | 'generateMeals'
>

export const MealSlots = ({
  api,
  eventId,
  shut = false,
}: {
  api: MealSlotsApi
  eventId: string
  shut?: boolean
}) => {
  const [label, setLabel] = useState('')
  const [at, setAt] = useState('13:00')
  const [kind, setKind] = useState<MealSlotKind>('meal')
  const [filled, setFilled] = useState<number | undefined>(undefined)

  const { loaded, reload } = useLoad(async (signal) => api.getMealSlots(eventId, signal), {
    key: eventId,
    fallback: 'Could not load the meal times.',
  })

  const { busy, error, run } = useAction(reload)
  const slots: readonly MealSlot[] = loaded.status === 'ready' ? loaded.data.slots : []

  return (
    <div class="meal-slots">
      <ErrorText message={error} />

      {loaded.status === 'failed' && <ErrorText message={loaded.message} />}

      {loaded.status === 'ready' && slots.length === 0 && (
        <p class="form-note">No meal times yet. A burn with none gets no kitchen in the schedule.</p>
      )}

      {shut && <p class="form-note">This burn has ended, so its meal times can only be read.</p>}

      <ul class="meal-slot-list">
        {slots.map((slot) => (
          <li key={slot.id}>
            <span>
              {slot.label} · {slot.at}
              {slot.kind === 'chore' && <span class="form-note"> (no cooking)</span>}
            </span>
            {!shut && (
              <>
                <input
                  type="time"
                  aria-label={`Time of ${slot.label}`}
                  disabled={busy}
                  value={slot.at}
                  onChange={(changeEvent) =>
                    run(
                      () => api.updateMealSlot(slot.id, { at: changeEvent.currentTarget.value }),
                      'Could not save that.',
                    )
                  }
                />
                <Destroy
                  what={slot.label}
                  busy={busy}
                  onDestroy={() => run(() => api.deleteMealSlot(slot.id), 'Could not remove that.')}
                />
              </>
            )}
          </li>
        ))}
      </ul>

      {!shut && (
        <>
          <div class="row">
            <label class="field">
              <span>Meal</span>
              <input
                type="text"
                maxLength={MAX_OPTION_LABEL}
                aria-label="New meal time name"
                placeholder="Lunch"
                value={label}
                onInput={(inputEvent) => setLabel(inputEvent.currentTarget.value)}
              />
            </label>

            <label class="field">
              <span>At</span>
              <input
                type="time"
                aria-label="New meal time"
                value={at}
                onInput={(inputEvent) => setAt(inputEvent.currentTarget.value)}
              />
            </label>

            <label class="field">
              <span>Kind</span>
              <select
                aria-label="New meal time kind"
                value={kind}
                onChange={(changeEvent) =>
                  setKind(changeEvent.currentTarget.value === 'chore' ? 'chore' : 'meal')
                }
              >
                <option value="meal">A meal — cooking, eating, washing up</option>
                <option value="chore">A chore — one hour of itself</option>
              </select>
            </label>

            <button
              type="button"
              disabled={busy || label.trim() === ''}
              onClick={() =>
                run(async () => {
                  await api.addMealSlot(eventId, { label: label.trim(), at, kind })
                  setLabel('')
                }, 'Could not add that.')
              }
            >
              Add it
            </button>
          </div>

          <p class="row">
            <button
              type="button"
              disabled={busy || slots.length === 0}
              onClick={() =>
                run(async () => {
                  const { meals } = await api.generateMeals(eventId)
                  setFilled(meals.length)
                }, 'Could not fill the days in.')
              }
            >
              Fill the days in
            </button>
            <span class="form-note">
              {filled === undefined
                ? 'Adds what is missing and leaves everything else alone, so it is safe to press again.'
                : `${filled} sittings on the plan.`}
            </span>
          </p>
        </>
      )}
    </div>
  )
}
