import type { EventOption } from '@sage-burner/shared'

import { MAX_NOTES, MAX_OPTION_LABEL } from '@sage-burner/shared'

import type { StayDraft } from '../stay.ts'

import { rowsFor } from '../textarea.ts'

/**
 * The questions one burn asks, without a form around them.
 *
 * Two forms ask them: `StayForm` on somebody's own page, and the invite page, where a
 * new member answers them in the same breath as choosing a password (#224). Split out
 * rather than duplicated — a second copy would be the lodging capacity rules written
 * twice, and those are the fiddly part.
 *
 * `lodgingTaken` decides what is full. The option somebody already holds is never
 * disabled, and that is compared against what is *saved* rather than what is picked:
 * against the live value, clicking away from a full option and back would find it
 * disabled, and a native select will not let you choose a disabled option. You would
 * be stuck until you reloaded. A new member holds nothing, so `heldLodging` is
 * undefined there and every full option is simply full.
 */
export const StayFields = ({
  draft,
  onChange,
  lodgingOptions = [],
  helpingOptions = [],
  lodgingTaken = {},
  heldLodging,
  signedInMember = false,
}: {
  draft: StayDraft
  onChange: (next: StayDraft) => void
  /** This burn's lodging list, in the admin's order. */
  lodgingOptions?: readonly EventOption[]
  /** This burn's helping-out list, in the admin's order. */
  helpingOptions?: readonly EventOption[]
  /** How many have already picked each option, by option id. */
  lodgingTaken?: Readonly<Record<string, number>>
  /** The lodging they are already down for, which is never offered as full. */
  heldLodging?: string | null
  /**
   * Whether the person filling this in is a signed-in member.
   *
   * Off on the invite page, which draws these fields before the account exists — and
   * a link to a members-only page is one that cannot be followed.
   */
  signedInMember?: boolean
}) => {
  const change = (part: Partial<StayDraft>) => onChange({ ...draft, ...part })

  return (
    <>
      <label class="field">
        <span>Arriving</span>
        <input
          type="date"
          name="arrival_date"
          // Bound to its partner so the picker cannot offer an inverted range at
          // all. The server still refuses one — a `max` is a hint a keyboard can
          // walk straight past — but this is the difference between being told
          // afterwards and never being able to say it.
          max={draft.departure_date === '' ? undefined : draft.departure_date}
          value={draft.arrival_date}
          onInput={(event) => change({ arrival_date: event.currentTarget.value })}
        />
      </label>

      <label class="field">
        <span>Leaving</span>
        <input
          type="date"
          name="departure_date"
          min={draft.arrival_date === '' ? undefined : draft.arrival_date}
          value={draft.departure_date}
          onInput={(event) => change({ departure_date: event.currentTarget.value })}
        />
      </label>

      {/* Beside the dates, which is where somebody is standing when they think about
          getting there. ☰ carries it as well, for everyone who has not joined a burn
          and so has no stay to read this from (#26). */}
      {signedInMember && (
        <p class="form-note">
          <a href="/rides">Looking for a lift, or offering one?</a>
        </p>
      )}

      <label class="field">
        <span>Where are you sleeping?</span>
        <select
          name="lodging_option_id"
          value={draft.lodging_option_id}
          onChange={(event) => change({ lodging_option_id: event.currentTarget.value })}
        >
          <option value="">Not decided yet</option>
          {lodgingOptions.map((option) => {
            const full = option.capacity !== null && (lodgingTaken[option.id] ?? 0) >= option.capacity
            const theirs = option.id === heldLodging

            return (
              <option key={option.id} value={option.id} disabled={full && !theirs}>
                {option.label}
                {option.capacity === null
                  ? ''
                  : full
                    ? ' — full'
                    : ` — ${option.capacity - (lodgingTaken[option.id] ?? 0)} left`}
              </option>
            )
          })}
        </select>
      </label>

      {/* The list itself is the burn's shared furniture, so the way to change it sits
          beside the question it answers rather than on a page of its own. Offered to
          everyone signed in, because everyone there may edit it — the page refuses
          anyone who may not, and so does the API. */}
      {signedInMember && (
        <p class="form-note">
          <a href="/options">(edit lodging alternatives)</a>
        </p>
      )}

      <fieldset class="field">
        <legend>What would you like to help with?</legend>

        {helpingOptions.length === 0 && (
          <p class="form-note">Nothing listed yet — write it in below if you already know.</p>
        )}

        {helpingOptions.map((option) => (
          <label key={option.id} class="field-inline">
            <input
              type="checkbox"
              checked={draft.helping_option_ids.includes(option.id)}
              onChange={(event) =>
                change({
                  helping_option_ids: event.currentTarget.checked
                    ? [...draft.helping_option_ids, option.id]
                    : draft.helping_option_ids.filter((id) => id !== option.id),
                })
              }
            />
            <span>{option.label}</span>
          </label>
        ))}

        <label class="field">
          <span>Something else</span>
          <input
            type="text"
            name="helping_other"
            maxLength={MAX_OPTION_LABEL}
            value={draft.helping_other}
            onInput={(event) => change({ helping_other: event.currentTarget.value })}
          />
        </label>
      </fieldset>

      <label class="field">
        <span>Anything else we should know?</span>
        <textarea
          name="notes"
          maxLength={MAX_NOTES}
          rows={rowsFor(draft.notes)}
          value={draft.notes}
          onInput={(event) => change({ notes: event.currentTarget.value })}
        />
      </label>
    </>
  )
}
