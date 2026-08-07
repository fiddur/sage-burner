import type { EventAttendeesResponse, Meal, MealsResponse } from '@sage-burner/shared'

import { MAX_OPTION_LABEL, MAX_WELCOME_LENGTH } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { useSelectedBurn } from '../burn.tsx'
import { ErrorText } from '../components/ErrorText.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { HelperStrip } from '../components/HelperStrip.tsx'
import { IconButton } from '../components/IconButton.tsx'
import { MarkdownField } from '../components/MarkdownField.tsx'
import { NoBurn } from '../components/NoBurn.tsx'
import { Refreshing } from '../components/Refreshing.tsx'
import { TheirVersion } from '../components/TheirVersion.tsx'
import { dayName } from '../datetime.ts'
import { useAction, useLoad } from '../load.ts'
import { renderMarkdown } from '../markdown.ts'
import { useViewer } from '../viewer.tsx'

export type MealsApi = Pick<
  ApiClient,
  | 'getMeals'
  | 'getEventAttendees'
  | 'setMealLead'
  | 'joinMealCrew'
  | 'leaveMealCrew'
  | 'setMealIdea'
  | 'updateMealIntro'
>

type Person = EventAttendeesResponse['attendees'][number]

/** Null rather than a fourth status: "no burn is selected" is data, not a load outcome. */
type Plan = (MealsResponse & { eventId: string; attendees: readonly Person[] }) | null

/**
 * The meal plan — who cooks, who helps and who washes up.
 *
 * The spreadsheet tab this replaces was open to everyone, and so is this: any
 * approved member may take a lead, hand one over, stand for a crew, write a food
 * idea, or rewrite the words at the top. The plan itself — which sittings exist —
 * is the admins', under Events.
 */
export const Meals = ({ api }: { api: MealsApi }) => {
  const viewer = useViewer()
  const burn = useSelectedBurn()
  const [editingIntro, setEditingIntro] = useState(false)

  const { loaded, refreshing, reload } = useLoad<Plan>(
    async (signal) => {
      if (burn === undefined) return null

      const [plan, attendees] = await Promise.all([
        api.getMeals(burn.event.id, signal),
        api.getEventAttendees(burn.event.id, signal),
      ])

      return { ...plan, eventId: burn.event.id, attendees: attendees.attendees }
    },
    { key: burn?.event.id ?? '', fallback: 'Could not load the meal plan.', live: true, remember: 'meals' },
  )

  const { busy, error, failure, run } = useAction(reload)
  const plan = loaded.status === 'ready' ? loaded.data : null

  return (
    <GuardedPage title="Meals" require="approved">
      <h1>
        Meals <Refreshing on={refreshing} />
      </h1>

      <ErrorText message={error} />

      {loaded.status === 'loading' && <p class="form-note">Loading…</p>}

      {loaded.status === 'failed' && <ErrorText message={loaded.message} />}

      {loaded.status === 'ready' && plan === null && <NoBurn absent="there is no meal plan to draw" />}

      {plan !== null && (
        <>
          {editingIntro ? (
            <IntroEditor
              intro={plan.intro_markdown}
              busy={busy}
              failure={failure}
              onCancel={() => setEditingIntro(false)}
              onSave={(meal_intro_markdown) =>
                run(async () => {
                  await api.updateMealIntro(plan.eventId, { meal_intro_markdown })
                  setEditingIntro(false)
                }, 'Could not save that.')
              }
            />
          ) : (
            <div class="meal-intro">
              {plan.intro_markdown.trim() === '' ? (
                <p class="form-note">Nothing said here yet.</p>
              ) : (
                // Safe by construction: `renderMarkdown` escapes raw HTML rather
                // than filtering it.
                <div
                  class="markdown-preview"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(plan.intro_markdown) }}
                />
              )}
              {/* A pen, not a sentence. "Edit these words" sat under a paragraph in the
                  same face as the paragraph, so it read as the last line of it. */}
              <IconButton
                icon="✏️"
                label="Edit these words"
                disabled={busy}
                onClick={() => setEditingIntro(true)}
              />
            </div>
          )}

          {plan.meals.length === 0 ? (
            <p class="form-note">
              {plan.slots.length === 0
                ? 'Nobody has set up meal times for this burn yet. Admins do that under Events.'
                : 'The meal times are set, but the days have not been filled in yet. Admins do that under Events.'}
            </p>
          ) : (
            <MealTable
              meals={plan.meals}
              attendees={plan.attendees}
              viewerId={viewer.account?.id}
              busy={busy}
              onLead={(id, accountId) =>
                run(() => api.setMealLead(id, { account_id: accountId }), 'Could not save that.')
              }
              onStand={(id, role, joining, accountId) =>
                run(
                  () =>
                    joining
                      ? api.joinMealCrew(id, role, { account_id: accountId })
                      : api.leaveMealCrew(id, role, accountId),
                  'Could not save that.',
                )
              }
              onIdea={(id, food_idea) =>
                run(() => api.setMealIdea(id, { food_idea }), 'Could not save that.')
              }
            />
          )}
        </>
      )}
    </GuardedPage>
  )
}

/**
 * The words above the table — the sheet's orange row.
 *
 * Any approved member, like the burn's welcome text: "everyone take at least 1
 * cooking and 1 cleaning spots" is the kind of thing whoever notices it should be
 * able to write down.
 */
const IntroEditor = ({
  intro,
  busy,
  failure,
  onSave,
  onCancel,
}: {
  intro: string
  busy: boolean
  failure?: unknown
  onSave: (intro: string) => void
  onCancel: () => void
}) => {
  // Seeded once. The page re-reads under a refused save (#274), and taking the
  // fresh words into the box would throw away the ones being written.
  const [draft, setDraft] = useState(intro)

  return (
    <div class="meal-intro">
      <MarkdownField
        label="What everyone should know"
        value={draft}
        maxLength={MAX_WELCOME_LENGTH}
        onInput={setDraft}
      />
      <TheirVersion failure={failure} at={['intro_markdown']} />
      <p class="row">
        <button type="button" disabled={busy} onClick={() => onSave(draft)}>
          Save
        </button>
        <button type="button" class="link-button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </p>
    </div>
  )
}

const MealTable = ({
  meals,
  attendees,
  viewerId,
  busy,
  onLead,
  onStand,
  onIdea,
}: {
  meals: readonly Meal[]
  attendees: readonly Person[]
  viewerId: string | undefined
  busy: boolean
  onLead: (id: string, accountId: string | null) => void
  onStand: (id: string, role: 'cleanup' | 'helper', joining: boolean, accountId: string) => void
  onIdea: (id: string, idea: string) => void
}) => (
  // Scrolls itself, like the schedule grid: five columns of crew lists are taller
  // than a phone, and taking the page with them put the header out of reach.
  <div class="meal-table-wrap">
    <table class="meal-table">
      <thead>
        <tr>
          <th scope="col">Meal</th>
          <th scope="col">Food</th>
          <th scope="col">Lead</th>
          <th scope="col">Help</th>
          <th scope="col">Cleanup</th>
        </tr>
      </thead>
      <tbody>
        {meals.map((meal, index) => (
          <tr key={meal.id}>
            <th scope="row">
              {/* The day only on the first sitting of it, like the sheet's merged
                  cells; the time on every row, since that is what tells them apart. */}
              {meals[index - 1]?.date === meal.date ? null : (
                <>
                  {dayName(meal.date, 'short')}
                  <br />
                </>
              )}
              <span class="meal-at">{meal.at}</span>
            </th>
            <td>
              <div>{meal.label}</div>
              <FoodIdea meal={meal} busy={busy} onIdea={onIdea} />
            </td>
            <td>
              {/* A chore has nobody cooking — unless one is still recorded from before
                  the slot became one, who then needs a way off. The API allows exactly
                  that: vacating stays open where handing over is refused. */}
              {meal.kind === 'chore' && meal.lead === null ? (
                <span class="form-note">—</span>
              ) : (
                <HelperStrip
                  label={`${meal.label} on ${meal.date}`}
                  people={meal.lead === null ? [] : [meal.lead]}
                  max={1}
                  // A chore takes no new lead, so it offers nobody — whoever is still
                  // on one has their ✕ regardless, which is what the API allows.
                  candidates={meal.kind === 'chore' ? [] : attendees}
                  everyone={attendees}
                  viewerId={viewerId}
                  busy={busy}
                  onAdd={(accountId) => onLead(meal.id, accountId)}
                  onRemove={() => onLead(meal.id, null)}
                />
              )}
            </td>
            {/* A chore asks for no cooks — but one already signed up before the slot
                became a chore still needs a way off, which the API allows. */}
            {meal.kind === 'chore' && meal.helpers.length === 0 ? (
              <td>
                <span class="form-note">—</span>
              </td>
            ) : (
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
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)

/** The sheet's "Food idea?" column: what somebody thought of cooking, if anything. */
const FoodIdea = ({
  meal,
  busy,
  onIdea,
}: {
  meal: Meal
  busy: boolean
  onIdea: (id: string, idea: string) => void
}) => {
  const [draft, setDraft] = useState(meal.food_idea)

  // Nothing is cooked at a chore, so there is nothing to have an idea about — the
  // box offered one for a morning cleanup, which is the sheet's column applied to a
  // row the sheet never had.
  if (meal.kind === 'chore') return <span class="form-note">—</span>

  return (
    <input
      type="text"
      class="meal-idea"
      maxLength={MAX_OPTION_LABEL}
      placeholder="What's cooking?"
      aria-label={`Food idea for ${meal.label} on ${meal.date}`}
      disabled={busy}
      value={draft}
      onInput={(inputEvent) => setDraft(inputEvent.currentTarget.value)}
      // On blur rather than on every keystroke: this is a note several people pass
      // through, and a request per character would be a request per character.
      onBlur={() => {
        if (draft !== meal.food_idea) onIdea(meal.id, draft)
      }}
    />
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
  onStand: (id: string, role: 'cleanup' | 'helper', joining: boolean, accountId: string) => void
}) => {
  const crew = role === 'helper' ? meal.helpers : meal.cleanup

  // The lead is already cooking it, so they are not offered as a pair of hands for
  // the cooking — they may still wash up, which is why this is per role rather than
  // per meal. Nobody at all may be added to a chore's cooks.
  const offerable = joinable
    ? attendees.filter((who) => role === 'cleanup' || who.account_id !== meal.lead?.account_id)
    : []

  return (
    <td>
      <HelperStrip
        label={`${role === 'helper' ? 'cooking' : 'cleanup'} at ${meal.label} on ${meal.date}`}
        people={crew}
        candidates={offerable}
        everyone={attendees}
        viewerId={viewerId}
        busy={busy}
        onAdd={(accountId) => onStand(meal.id, role, true, accountId)}
        onRemove={(accountId) => onStand(meal.id, role, false, accountId)}
      />
    </td>
  )
}
