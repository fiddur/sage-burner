import type {
  Eater,
  EventPantryItem,
  Meal,
  Shoppable,
  ShoppingRow,
  ShoppingSections,
  Sitting,
} from '@sage-burner/shared'

import {
  askedSaid,
  buySaid,
  cannotEat,
  haveSaid,
  placesSaid,
  shoppingSections,
  shoppingText,
} from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { useSelectedBurn } from '../burn.tsx'
import { CopyButton } from '../components/CopyButton.tsx'
import { ErrorText } from '../components/ErrorText.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { NoBurn } from '../components/NoBurn.tsx'
import { NAMELESS } from '../components/PersonBadge.tsx'
import { Refreshing } from '../components/Refreshing.tsx'
import { localMoment } from '../datetime.ts'
import { useAction, useLoad } from '../load.ts'
import { isApproved, useViewer } from '../viewer.tsx'
import { usePhone } from '../viewport.ts'

export type ShoppingApi = Pick<
  ApiClient,
  | 'getEventPantry'
  | 'getMeals'
  | 'getMembers'
  | 'markPantryBought'
  | 'unmarkPantryBought'
  | 'markIngredientBought'
  | 'unmarkIngredientBought'
>

type Tick = (row: ShoppingRow, bought: boolean) => void

const CannotEat = ({ row, roster }: { row: ShoppingRow; roster: readonly Eater[] }) => {
  const { who } = cannotEat(
    roster,
    null,
    row.allergies.map((tag) => tag.id),
  )

  return who.length === 0 ? null : <span class="allergy-said">{who.length} cannot eat this</span>
}

interface Filling {
  sections: ShoppingSections
  note: string
}

const asShoppable = (item: EventPantryItem): Shoppable => ({
  ...item,
  need_more: item.need_more !== null,
})

const asSitting = (meal: Meal): Sitting => ({
  label: meal.label,
  date: meal.date,
  serves: meal.serves,
  lead: meal.lead === null ? null : { name: meal.lead.name ?? NAMELESS },
  ingredients: meal.ingredients,
})

const boughtBy = (row: ShoppingRow): string => {
  if (row.bought === null) return ''

  const who = row.bought.by === null ? 'somebody who has left' : (row.bought.by_name ?? NAMELESS)

  return `${who} · ${localMoment(row.bought.at)}`
}

export const Shopping = ({ api }: { api: ShoppingApi }) => {
  const viewer = useViewer()
  const burn = useSelectedBurn()
  const [buyingFor, setBuyingFor] = useState('')

  const { loaded, refreshing, reload } = useLoad(
    async (signal) => {
      if (burn === undefined) return { items: [], meals: [], entries: [], cap: 0 }

      const [pantry, plan, roster] = await Promise.all([
        api.getEventPantry(burn.event.id, signal),
        api.getMeals(burn.event.id, signal),
        api.getMembers(burn.event.id, signal),
      ])

      return {
        items: pantry.items,
        meals: plan.meals,
        entries: roster.entries,
        cap: roster.event?.member_cap ?? 0,
      }
    },
    {
      enabled: isApproved(viewer),
      key: burn?.event.id ?? '',
      fallback: 'Could not load the shopping list.',
      live: true,
      remember: 'shopping',
    },
  )

  const { busy, error, run } = useAction(reload)

  const asked = Number(buyingFor)
  const heads = buyingFor.trim() === '' || !Number.isFinite(asked) || asked < 1 ? null : Math.floor(asked)

  const held = loaded.status === 'ready' ? loaded.data : { items: [], meals: [], entries: [], cap: 0 }
  const sittings = held.meals.map(asSitting)

  const filling: Filling = {
    sections: shoppingSections({
      items: held.items.map(asShoppable),
      sittings,
      entries: held.entries,
      cap: held.cap,
      buying_for: heads,
    }),
    note: placesSaid(
      held.entries,
      held.cap,
      sittings.filter((sitting) => sitting.ingredients.length > 0).map((sitting) => sitting.date),
    ),
  }

  const tick: Tick = (row, bought) => {
    if (burn === undefined) return

    run(async () => {
      if (row.pantry_item_id !== null) {
        return bought
          ? await api.markPantryBought(burn.event.id, row.pantry_item_id)
          : await api.unmarkPantryBought(burn.event.id, row.pantry_item_id)
      }

      for (const id of row.ingredient_ids) {
        await (bought ? api.markIngredientBought(id) : api.unmarkIngredientBought(id))
      }

      return undefined
    }, 'Could not save that.')
  }

  return (
    <GuardedPage title="Shopping list" require="approved">
      <h1>
        Shopping list <Refreshing on={refreshing} />
      </h1>

      <ErrorText message={error} />

      {loaded.status === 'loading' && <p class="form-note">Loading…</p>}
      {loaded.status === 'failed' && <ErrorText message={loaded.message} />}

      {loaded.status === 'ready' && burn === undefined && <NoBurn absent="there is nothing to shop for" />}

      {loaded.status === 'ready' && burn !== undefined && (
        <>
          <p class="row">
            <label class="shopping-heads">
              <span>Buying for</span>
              <input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                aria-label="Buying for how many people"
                value={buyingFor}
                onInput={(typing) => setBuyingFor(typing.currentTarget.value)}
              />
              <span>people</span>
            </label>
            <CopyButton value={shoppingText(filling.sections)} label="Copy as text" />
          </p>

          <p class="form-note">
            {filling.note}. Each sitting is counted for the people there that day; a number here replaces that
            for every sitting, which is where the margin goes. Amounts round up to whole pieces and packets
            and to a tenth of a kilo or litre.
          </p>

          <List sections={filling.sections} roster={held.entries} busy={busy} onTick={tick} />
        </>
      )}
    </GuardedPage>
  )
}

const List = ({
  sections,
  roster,
  busy,
  onTick,
}: {
  sections: ShoppingSections
  roster: readonly Eater[]
  busy: boolean
  onTick: Tick
}) => {
  const [showingEnough, setShowingEnough] = useState(false)
  const phone = usePhone()

  const Rows = phone ? PhoneRows : WideRows

  return (
    <>
      <section>
        <h2>From the pantry</h2>
        <p class="form-note">What the meals and the hearts ask for, less what is already in the house.</p>

        {sections.pantry.length === 0 ? (
          <p class="form-note">
            Nothing is waiting to be bought. Hearts on the Meals and Pantry pages fill this list, and so do
            the ingredients of a sitting.
          </p>
        ) : (
          <Rows rows={sections.pantry} roster={roster} bought={false} busy={busy} onTick={onTick} />
        )}

        {sections.enough.length > 0 && (
          <p>
            <button
              type="button"
              class="link-button"
              aria-expanded={showingEnough}
              onClick={() => setShowingEnough(!showingEnough)}
            >
              {showingEnough ? 'Hide' : 'Show'} the {sections.enough.length} thing
              {sections.enough.length === 1 ? '' : 's'} there is enough of
            </button>
          </p>
        )}

        {showingEnough && (
          <Rows rows={sections.enough} roster={roster} bought={false} busy={busy} onTick={onTick} />
        )}
      </section>

      {sections.special.length > 0 && (
        <section>
          <h2>Special for a meal</h2>
          <p class="form-note">Not in the pantry. Written by the cook as it is here.</p>
          <Rows rows={sections.special} roster={roster} bought={false} busy={busy} onTick={onTick} />
        </section>
      )}

      {sections.bought.length > 0 && (
        <section>
          <h2>Bought</h2>
          <Rows rows={sections.bought} roster={roster} bought busy={busy} onTick={onTick} />
        </section>
      )}
    </>
  )
}

interface RowsProps {
  rows: readonly ShoppingRow[]
  roster: readonly Eater[]
  bought: boolean
  busy: boolean
  onTick: Tick
}

const PhoneRows = ({ rows, bought, busy, onTick }: RowsProps) => (
  <ul class="shopping-list">
    {rows.map((row) => (
      <li key={row.key}>
        <label class={bought ? 'shopping-row is-bought' : 'shopping-row'}>
          <input
            type="checkbox"
            class="shopping-tick"
            checked={bought}
            disabled={busy}
            aria-label={`Bought ${row.name}`}
            onChange={(ticked) => onTick(row, ticked.currentTarget.checked)}
          />
          <span class="shopping-what">
            <span class="shopping-name">{row.name}</span>
            <span class="form-note">
              {[
                ...(row.pantry_item_id === null ? [] : [haveSaid(row)]),
                ...(row.where === '' ? [] : [row.where]),
              ].join(' · ')}
            </span>
            <span class="form-note">{askedSaid(row)}</span>
            {bought && <span class="form-note">{boughtBy(row)}</span>}
          </span>
          <span class="shopping-buy">{buySaid(row)}</span>
        </label>
      </li>
    ))}
  </ul>
)

const WideRows = ({ rows, roster, bought, busy, onTick }: RowsProps) => (
  <table class="shopping-table">
    <thead>
      <tr>
        <th scope="col">
          <span class="visually-hidden">Bought</span>
        </th>
        <th scope="col">Thing</th>
        <th scope="col">Need</th>
        <th scope="col">Have</th>
        <th scope="col">Buy</th>
        <th scope="col">Where it lives</th>
        <th scope="col">Asked for by</th>
      </tr>
    </thead>
    <tbody>
      {rows.map((row) => (
        <tr key={row.key} class={bought ? 'is-bought' : undefined}>
          <td>
            <input
              type="checkbox"
              class="shopping-tick"
              checked={bought}
              disabled={busy}
              aria-label={`Bought ${row.name}`}
              onChange={(ticked) => onTick(row, ticked.currentTarget.checked)}
            />
          </td>
          <th scope="row">
            <span class="shopping-name">{row.name}</span>
            {row.pantry_item_id === null && <span class="ingredient-mark is-special">special buy</span>}
          </th>
          <td class="shopping-figure">{row.need === null ? '' : `${row.need} ${row.unit}`}</td>
          <td class="shopping-figure form-note">{row.pantry_item_id === null ? '' : haveSaid(row)}</td>
          <td class="shopping-figure">
            {buySaid(row)}
            {bought && <span class="form-note">{boughtBy(row)}</span>}
          </td>
          <td class="form-note">{row.where}</td>
          <td class="form-note">
            {askedSaid(row)}
            <CannotEat row={row} roster={roster} />
          </td>
        </tr>
      ))}
    </tbody>
  </table>
)
