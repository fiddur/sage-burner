import type { Meal, MealIngredient, MealIngredientCreateInput, PantryItem } from '@sage-burner/shared'

import { dayName, haveSaid, MAX_OPTION_LABEL, MAX_UNIT } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import { IconButton } from './IconButton.tsx'

const MATCHES = 6

export interface IngredientsProps {
  meal: Meal
  pantry: readonly PantryItem[]
  heads: number | null
  busy: boolean
  onServes: (serves: number) => void
  onAdd: (line: MealIngredientCreateInput) => void
  onAmount: (id: string, amount: number | null) => void
  onRemove: (id: string) => void
}

type Picked = { kind: 'pick'; item: PantryItem } | { kind: 'written'; name: string }

const amountOf = (text: string): number | null | undefined => {
  if (text.trim() === '') return null

  const amount = Number(text.replace(',', '.'))

  return Number.isFinite(amount) && amount >= 0 ? amount : undefined
}

const shown = (amount: number | null): string => (amount === null ? '' : String(amount))

const standing = (item: {
  where: string
  unit: string
  stock_level: PantryItem['stock_level']
  stock_amount: number | null
}): string => [item.where, haveSaid(item)].filter((part) => part !== '').join(' · ')

export const Ingredients = ({
  meal,
  pantry,
  heads,
  busy,
  onServes,
  onAdd,
  onAmount,
  onRemove,
}: IngredientsProps) => (
  <section class="ingredients">
    <div class="ingredients-head">
      <h3>Ingredients</h3>
      <Serves meal={meal} busy={busy} onServes={onServes} />
    </div>

    <p class="form-note">
      Write it for any number. The shopping list scales it to the {heads === null ? 'people' : `${heads}`} who
      are here on {dayName(meal.date)}.
    </p>

    <ul class="ingredient-list">
      {meal.ingredients.map((line) => (
        <Row key={line.id} line={line} busy={busy} onAmount={onAmount} onRemove={onRemove} />
      ))}
    </ul>

    <AddIngredient meal={meal} pantry={pantry} busy={busy} onAdd={onAdd} />
  </section>
)

const Serves = ({
  meal,
  busy,
  onServes,
}: {
  meal: Meal
  busy: boolean
  onServes: (serves: number) => void
}) => {
  const [draft, setDraft] = useState(String(meal.serves))

  const save = () => {
    const serves = Number(draft)
    if (Number.isInteger(serves) && serves >= 1 && serves !== meal.serves) onServes(serves)
  }

  return (
    <label class="ingredient-serves">
      <span>Feeds</span>
      <input
        type="number"
        min={1}
        step={1}
        inputMode="numeric"
        aria-label={`How many ${meal.label} feeds`}
        disabled={busy}
        value={draft}
        onInput={(typing) => setDraft(typing.currentTarget.value)}
        onBlur={save}
        onKeyDown={(press) => {
          if (press.key === 'Enter') press.currentTarget.blur()
        }}
      />
      <span>people</span>
    </label>
  )
}

const Row = ({
  line,
  busy,
  onAmount,
  onRemove,
}: {
  line: MealIngredient
  busy: boolean
  onAmount: (id: string, amount: number | null) => void
  onRemove: (id: string) => void
}) => {
  const [draft, setDraft] = useState(shown(line.amount))

  const save = () => {
    const amount = amountOf(draft)
    if (amount !== undefined && amount !== line.amount) onAmount(line.id, amount)
  }

  return (
    <li class="ingredient-row">
      <span class="ingredient-what">
        <span class="ingredient-name">
          {line.name}{' '}
          <span class={line.pantry === null ? 'ingredient-mark is-special' : 'ingredient-mark is-pantry'}>
            {line.pantry === null ? 'special buy' : 'pantry'}
          </span>
        </span>
        {line.pantry !== null && (
          <span class="form-note">{standing({ ...line.pantry, unit: line.unit })}</span>
        )}
      </span>

      <input
        type="text"
        inputMode="decimal"
        class="ingredient-amount"
        aria-label={`Amount of ${line.name}`}
        disabled={busy}
        value={draft}
        onInput={(typing) => setDraft(typing.currentTarget.value)}
        onBlur={save}
        onKeyDown={(press) => {
          if (press.key === 'Enter') press.currentTarget.blur()
        }}
      />
      <span class="form-note ingredient-unit">{line.amount === null ? 'to taste' : line.unit}</span>

      <IconButton
        icon="close"
        label={`Remove ${line.name}`}
        disabled={busy}
        onClick={() => onRemove(line.id)}
      />
    </li>
  )
}

const AddIngredient = ({
  meal,
  pantry,
  busy,
  onAdd,
}: {
  meal: Meal
  pantry: readonly PantryItem[]
  busy: boolean
  onAdd: (line: MealIngredientCreateInput) => void
}) => {
  const [looking, setLooking] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const [picked, setPicked] = useState<Picked | undefined>(undefined)

  const matches = pantry
    .filter(
      (item) => item.withdrawn_at === null && item.name.toLowerCase().includes(looking.trim().toLowerCase()),
    )
    .slice(0, MATCHES)

  const take = (at: number) => {
    const item = matches[at]

    setLooking('')
    setHighlighted(0)
    setPicked(item === undefined ? { kind: 'written', name: looking.trim() } : { kind: 'pick', item })
  }

  if (picked !== undefined) {
    return (
      <Filling
        picked={picked}
        busy={busy}
        onAdd={(line) => {
          setPicked(undefined)
          onAdd(line)
        }}
        onCancel={() => setPicked(undefined)}
      />
    )
  }

  return (
    <div class="ingredient-add">
      <input
        type="text"
        maxLength={MAX_OPTION_LABEL}
        placeholder="Add an ingredient"
        aria-label={`Add an ingredient to ${meal.label}`}
        disabled={busy}
        value={looking}
        onInput={(typing) => {
          setLooking(typing.currentTarget.value)
          setHighlighted(0)
        }}
        onKeyDown={(press) => {
          if (press.key === 'ArrowDown') {
            press.preventDefault()
            setHighlighted(Math.min(highlighted + 1, matches.length))
          }
          if (press.key === 'ArrowUp') {
            press.preventDefault()
            setHighlighted(Math.max(highlighted - 1, 0))
          }
          if (press.key === 'Enter') {
            press.preventDefault()
            if (looking.trim() !== '') take(highlighted)
          }
        }}
      />

      {looking.trim() !== '' && (
        <div class="ingredient-matches">
          {matches.map((item, at) => (
            <button
              key={item.id}
              type="button"
              class={at === highlighted ? 'ingredient-match is-on' : 'ingredient-match'}
              aria-current={at === highlighted}
              disabled={busy}
              onClick={() => take(at)}
            >
              <span>
                {item.name} <span class="form-note">{item.unit}</span>
              </span>
              <span class="form-note">{standing(item)}</span>
            </button>
          ))}

          <button
            type="button"
            class={matches.length === highlighted ? 'ingredient-match is-on' : 'ingredient-match'}
            aria-current={matches.length === highlighted}
            disabled={busy}
            onClick={() => take(matches.length)}
          >
            <span>Use “{looking.trim()}” as written</span>
            <span class="form-note">A special buy, listed apart from the pantry</span>
          </button>
        </div>
      )}
    </div>
  )
}

const Filling = ({
  picked,
  busy,
  onAdd,
  onCancel,
}: {
  picked: Picked
  busy: boolean
  onAdd: (line: MealIngredientCreateInput) => void
  onCancel: () => void
}) => {
  const [unit, setUnit] = useState(picked.kind === 'pick' ? picked.item.unit : 'pcs')
  const [amount, setAmount] = useState('')

  const name = picked.kind === 'pick' ? picked.item.name : picked.name
  const asked = amountOf(amount)

  return (
    <div class="ingredient-add">
      <p class="row">
        <span class="ingredient-name">{name}</span>

        {picked.kind === 'written' && (
          <input
            type="text"
            class="ingredient-unit-input"
            maxLength={MAX_UNIT}
            aria-label={`Unit for ${name}`}
            disabled={busy}
            value={unit}
            onInput={(typing) => setUnit(typing.currentTarget.value)}
          />
        )}

        <input
          type="text"
          inputMode="decimal"
          class="ingredient-amount"
          placeholder="Amount"
          aria-label={`Amount of ${name}`}
          disabled={busy}
          value={amount}
          onInput={(typing) => setAmount(typing.currentTarget.value)}
        />

        {picked.kind === 'pick' && <span class="form-note ingredient-unit">{picked.item.unit}</span>}

        <button
          type="button"
          disabled={busy || asked === undefined || (picked.kind === 'written' && unit.trim() === '')}
          onClick={() =>
            onAdd(
              picked.kind === 'pick'
                ? { pantry_item_id: picked.item.id, amount: asked ?? null }
                : { name, unit: unit.trim(), amount: asked ?? null },
            )
          }
        >
          Add
        </button>
        <button type="button" class="link-button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </p>
    </div>
  )
}
