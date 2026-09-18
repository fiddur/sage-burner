import type { Eater, Meal, MealIngredient, PantryItem } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { IngredientsProps } from './Ingredients.tsx'

import { Ingredients } from './Ingredients.tsx'

afterEach(cleanup)

const item = (over: Partial<PantryItem> = {}): PantryItem => ({
  id: 'p-1',
  kind: 'staple',
  name: 'Lemon',
  unit: 'pcs',
  places: [{ place_id: 'pl-1', name: 'Kitchen', spot: 'fridge' }],
  stock_level: 'some',
  stock_amount: 6,
  counted_by: null,
  counted_by_name: null,
  counted_at: null,
  need_more: null,
  withdrawn_at: null,
  created_at: '2026-07-01T00:00:00.000Z',
  allergies: [],
  ...over,
})

const PANTRY = [
  item(),
  item({ id: 'p-2', name: 'Lemon juice', unit: 'dl', stock_level: 'plenty', stock_amount: null }),
  item({ id: 'p-3', name: 'Rice, basmati', unit: 'kg', stock_level: null, stock_amount: null }),
  item({ id: 'p-4', name: 'Lemon pepper', unit: 'g', withdrawn_at: '2026-08-01T00:00:00.000Z' }),
]

const line = (over: Partial<MealIngredient> = {}): MealIngredient => ({
  id: 'i-1',
  pantry_item_id: 'p-3',
  name: 'Rice, basmati',
  unit: 'kg',
  amount: 1.2,
  bought: null,
  pantry: {
    places: [{ place_id: 'pl-2', name: 'Hallway', spot: 'bucket' }],
    stock_level: 'plenty',
    stock_amount: null,
    allergies: [],
  },
  ...over,
})

const aMeal = (over: Partial<Meal> = {}): Meal => ({
  id: 'm-1',
  event_id: 'e-1',
  date: '2026-08-01',
  at: '18:00',
  label: 'Dinner',
  kind: 'meal',
  food_idea: '',
  serves: 10,
  lead: null,
  helpers: [],
  cleanup: [],
  ingredients: [],
  ...over,
})

const show = (over: Partial<IngredientsProps> = {}) => {
  const props: IngredientsProps = {
    meal: aMeal(),
    eventId: 'e-1',
    pantry: PANTRY,
    roster: [],
    heads: 34,
    busy: false,
    onServes: () => undefined,
    onAdd: () => undefined,
    onAmount: () => undefined,
    onRemove: () => undefined,
    ...over,
  }

  render(<Ingredients {...props} />)

  return props
}

describe('how many the sitting feeds', () => {
  it('says what the shopping list will do with the number', () => {
    show()

    expect(screen.getByText(/scales it to the 34 who are here on Saturday 1/)).toBeTruthy()
  })

  it('says only “people” when nobody has said who is coming', () => {
    show({ heads: null })

    expect(screen.getByText(/scales it to the people who are here on Saturday 1/)).toBeTruthy()
  })

  it('saves a new number when the field is left', () => {
    const onServes = vi.fn()
    show({ onServes })

    const field = screen.getByLabelText('How many Dinner feeds')
    fireEvent.input(field, { target: { value: '20' } })
    fireEvent.blur(field)

    expect(onServes).toHaveBeenCalledWith(20)
  })

  it('saves nothing when the number is the one already there', () => {
    const onServes = vi.fn()
    show({ onServes })

    fireEvent.blur(screen.getByLabelText('How many Dinner feeds'))

    expect(onServes).not.toHaveBeenCalled()
  })
})

describe('the lines of a sitting', () => {
  it('marks a pantry pick, with where it lives and what is there', () => {
    show({ meal: aMeal({ ingredients: [line()] }) })

    expect(screen.getByText('pantry')).toBeTruthy()
    expect(screen.getByText('Hallway bucket · have plenty')).toBeTruthy()
  })

  it('marks a special buy, which has no place and no count', () => {
    show({
      meal: aMeal({
        ingredients: [line({ pantry_item_id: null, name: 'Saffron', unit: 'pcs', pantry: null })],
      }),
    })

    expect(screen.getByText('special buy')).toBeTruthy()
    expect(screen.queryByText(/have/)).toBeNull()
  })

  it('says “to taste” where no amount was written', () => {
    show({ meal: aMeal({ ingredients: [line({ amount: null })] }) })

    expect(screen.getByText('to taste')).toBeTruthy()
  })

  it('saves a changed amount when the field is left', () => {
    const onAmount = vi.fn()
    show({ meal: aMeal({ ingredients: [line()] }), onAmount })

    const field = screen.getByLabelText('Amount of Rice, basmati')
    fireEvent.input(field, { target: { value: '2' } })
    fireEvent.blur(field)

    expect(onAmount).toHaveBeenCalledWith('i-1', 2)
  })

  it('saves it on Enter too', () => {
    const onAmount = vi.fn()
    show({ meal: aMeal({ ingredients: [line()] }), onAmount })

    const field = screen.getByLabelText('Amount of Rice, basmati')
    field.focus()
    fireEvent.input(field, { target: { value: '3' } })
    fireEvent.keyDown(field, { key: 'Enter' })

    expect(onAmount).toHaveBeenCalledWith('i-1', 3)
  })

  it('takes an emptied amount as “to taste”', () => {
    const onAmount = vi.fn()
    show({ meal: aMeal({ ingredients: [line()] }), onAmount })

    const field = screen.getByLabelText('Amount of Rice, basmati')
    fireEvent.input(field, { target: { value: '' } })
    fireEvent.blur(field)

    expect(onAmount).toHaveBeenCalledWith('i-1', null)
  })

  it('saves nothing for an amount nobody changed, or one that is not a number', () => {
    const onAmount = vi.fn()
    show({ meal: aMeal({ ingredients: [line()] }), onAmount })

    const field = screen.getByLabelText('Amount of Rice, basmati')
    fireEvent.blur(field)
    fireEvent.input(field, { target: { value: 'a lot' } })
    fireEvent.blur(field)

    expect(onAmount).not.toHaveBeenCalled()
  })

  it('takes a line off', () => {
    const onRemove = vi.fn()
    show({ meal: aMeal({ ingredients: [line()] }), onRemove })

    fireEvent.click(screen.getByLabelText('Remove Rice, basmati'))

    expect(onRemove).toHaveBeenCalledWith('i-1')
  })
})

describe('adding a line', () => {
  const type = (what: string) => {
    const field = screen.getByLabelText('Add an ingredient to Dinner')
    fireEvent.input(field, { target: { value: what } })

    return field
  }

  it('shows nothing until something is typed', () => {
    show()

    expect(screen.queryByText(/as written/)).toBeNull()
  })

  it('filters the pantry, leaving out what was taken off the list', () => {
    show()
    type('lem')

    expect(screen.getByText('Lemon')).toBeTruthy()
    expect(screen.getByText('Lemon juice')).toBeTruthy()
    expect(screen.queryByText('Lemon pepper')).toBeNull()
  })

  it('offers what is there and where it lives', () => {
    show()
    type('lem')

    expect(screen.getByText('Kitchen fridge · have about 6 pcs')).toBeTruthy()
  })

  it('always offers the words as written, whatever matched', () => {
    show()
    type('lem')

    expect(screen.getByText('Use “lem” as written')).toBeTruthy()
  })

  it('picks a pantry row with the arrow keys and Enter, then asks only for the amount', () => {
    const onAdd = vi.fn()
    show({ onAdd })
    const field = type('lem')

    fireEvent.keyDown(field, { key: 'ArrowDown' })
    fireEvent.keyDown(field, { key: 'Enter' })

    fireEvent.input(screen.getByLabelText('Amount of Lemon juice'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(onAdd).toHaveBeenCalledWith({ pantry_item_id: 'p-2', amount: 2 })
  })

  it('picks nothing on Enter in an empty box, since nothing was asked for', () => {
    const onAdd = vi.fn()
    show({ onAdd })
    const field = type('')

    fireEvent.keyDown(field, { key: 'Enter' })

    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull()
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('comes back up the list with the arrow keys', () => {
    const onAdd = vi.fn()
    show({ onAdd })
    const field = type('lem')

    fireEvent.keyDown(field, { key: 'ArrowDown' })
    fireEvent.keyDown(field, { key: 'ArrowUp' })
    fireEvent.keyDown(field, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(onAdd).toHaveBeenCalledWith({ pantry_item_id: 'p-1', amount: null })
  })

  it('takes the words as written as a special buy, which asks for a unit as well', () => {
    const onAdd = vi.fn()
    show({ onAdd })
    type('Saffron, 1 g sachets')

    fireEvent.click(screen.getByRole('button', { name: /as written/ }))
    fireEvent.input(screen.getByLabelText('Unit for Saffron, 1 g sachets'), { target: { value: 'pcs' } })
    fireEvent.input(screen.getByLabelText('Amount of Saffron, 1 g sachets'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(onAdd).toHaveBeenCalledWith({ name: 'Saffron, 1 g sachets', unit: 'pcs', amount: 2 })
  })

  it('takes the words as written when nothing in the pantry matches', () => {
    const onAdd = vi.fn()
    show({ onAdd })
    const field = type('Kombu')

    fireEvent.keyDown(field, { key: 'Enter' })

    expect(screen.getByLabelText('Unit for Kombu')).toBeTruthy()
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('will not add a special buy with no unit', () => {
    show()
    type('Kombu')

    fireEvent.click(screen.getByRole('button', { name: /as written/ }))
    fireEvent.input(screen.getByLabelText('Unit for Kombu'), { target: { value: ' ' } })

    expect(screen.getByRole('button', { name: 'Add' }).getAttribute('disabled')).not.toBeNull()
  })

  it('will not add an amount that is not a number', () => {
    show()
    type('lem')

    fireEvent.click(screen.getByRole('button', { name: /as written/ }))
    fireEvent.input(screen.getByLabelText('Amount of lem'), { target: { value: 'some' } })

    expect(screen.getByRole('button', { name: 'Add' }).getAttribute('disabled')).not.toBeNull()
  })

  it('gives up on the whole thing', () => {
    show()
    type('lem')

    fireEvent.click(screen.getByRole('button', { name: /as written/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByLabelText('Add an ingredient to Dinner')).toBeTruthy()
  })
})

const NUTS = { id: 'al-1', label: 'Nuts' }
const GLUTEN = { id: 'al-2', label: 'Gluten' }

const eater = (over: Partial<Eater> = {}): Eater => ({
  account_id: 'a-1',
  name: 'Anna L',
  waiting: false,
  arrival_date: null,
  departure_date: null,
  allergy_item_ids: [],
  allergies_notes: '',
  ...over,
})

const cashew = (over: Partial<MealIngredient> = {}) =>
  line({
    id: 'i-9',
    pantry_item_id: 'p-9',
    name: 'Cashew',
    unit: 'g',
    amount: 200,
    pantry: {
      places: [{ place_id: 'pl-2', name: 'Hallway', spot: 'bucket' }],
      stock_level: null,
      stock_amount: null,
      allergies: [NUTS],
    },
    ...over,
  })

describe('who among the people there cannot eat a line', () => {
  it("says how many of the day's headcount, and names them", () => {
    show({
      meal: aMeal({ ingredients: [cashew()] }),
      roster: [
        eater({ allergy_item_ids: ['al-1'] }),
        eater({ account_id: 'a-2', name: 'Bo K', allergy_item_ids: ['al-1'] }),
        eater({ account_id: 'a-3', name: 'Cilla Y' }),
      ],
    })

    expect(screen.getByText(/2 of the 34 here on Saturday 1 cannot eat this/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Anna L' }).getAttribute('href')).toBe('/members/a-1')
    expect(screen.getByRole('link', { name: 'Bo K' })).toBeTruthy()
  })

  it('says nothing about a line the pantry carries no tag for', () => {
    show({
      meal: aMeal({ ingredients: [line()] }),
      roster: [eater({ allergy_item_ids: ['al-1'] })],
    })

    expect(screen.queryByText(/cannot eat this/)).toBeNull()
  })

  it('says nothing under an untagged line about what somebody wrote under Other', () => {
    show({
      meal: aMeal({ ingredients: [line()] }),
      roster: [eater({ allergies_notes: 'red lentils make me ill' })],
    })

    expect(screen.queryByText(/wrote something under Other/)).toBeNull()
  })

  it('leaves out somebody whose stay misses the day', () => {
    show({
      meal: aMeal({ ingredients: [cashew()] }),
      roster: [eater({ allergy_item_ids: ['al-1'], departure_date: '2026-07-31' })],
    })

    expect(screen.queryByText(/cannot eat this/)).toBeNull()
  })

  it('counts what somebody wrote under Other without reading it, and links to the roster', () => {
    show({
      meal: aMeal({ ingredients: [cashew()] }),
      roster: [eater({ allergies_notes: 'red lentils make me ill' })],
    })

    expect(screen.getByText(/1 more wrote something under Other/)).toBeTruthy()
    expect(screen.queryByText(/red lentils/)).toBeNull()
    expect(screen.getByRole('link', { name: 'see the roster' }).getAttribute('href')).toBe(
      '/members?burn=e-1',
    )
  })

  it('says nothing at all when nobody there is concerned', () => {
    show({ meal: aMeal({ ingredients: [cashew()] }), roster: [eater()] })

    expect(screen.queryByText(/cannot eat this/)).toBeNull()
    expect(screen.queryByText(/under Other/)).toBeNull()
  })

  it('shows the tags beside a match in the picker, so the nudge is towards the thing without them', () => {
    show({
      pantry: [
        item({ id: 'p-9', name: 'Cashew', allergies: [NUTS, GLUTEN] }),
        item({ id: 'p-10', name: 'Cashew-free spread' }),
      ],
    })

    fireEvent.input(screen.getByLabelText('Add an ingredient to Dinner'), {
      target: { value: 'cashew' },
    })

    expect(screen.getByText('Nuts')).toBeTruthy()
    expect(screen.getByText('Gluten')).toBeTruthy()
  })
})
