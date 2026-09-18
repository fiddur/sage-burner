import type { EventPantryItem, Meal, MealIngredient, MemberRosterEntry, MyBurn } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { ShoppingApi } from './Shopping.tsx'

import { BurnProvider } from '../burn.tsx'
import { onADesktop, onAPhone } from '../testing/viewport.ts'
import { ViewerProvider } from '../viewer.tsx'
import { Shopping } from './Shopping.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const MEMBER: Viewer = {
  status: 'signed-in',
  account: { id: 'a-1', name: 'Ada', avatar: null, roles: ['member'] },
}

const BURN: MyBurn = {
  event: {
    id: 'e-1',
    name: 'Summer burn',
    slug: 'summer',
    start_date: '2026-08-01',
    end_date: '2026-08-03',
    start_time: '00:00',
    end_time: '23:59',
  },
  attendance: null,
}

const thing = (over: Partial<EventPantryItem> = {}): EventPantryItem => ({
  id: 'p-1',
  kind: 'breakfast',
  name: 'Oatmeal',
  unit: 'kg',
  where: 'hallway, left white box',
  stock_level: null,
  stock_amount: null,
  counted_by: null,
  counted_by_name: null,
  counted_at: null,
  withdrawn_at: null,
  created_at: '2026-07-01T00:00:00.000Z',
  hearts: { count: 14, people: [], mine: true },
  bought: null,
  ...over,
})

const ITEMS: EventPantryItem[] = [
  thing(),
  thing({
    id: 'p-2',
    name: 'Rice',
    where: '',
    stock_level: 'plenty',
    hearts: { count: 2, people: [], mine: false },
  }),
  thing({
    id: 'p-3',
    name: 'Candles, tea lights',
    kind: 'household',
    where: '',
    hearts: { count: 5, people: [], mine: false },
    bought: { by: 'a-2', by_name: 'Bo', at: '2026-07-30T09:00:00.000Z' },
  }),
  thing({
    id: 'p-4',
    name: 'Lentils, red',
    kind: 'staple',
    where: 'Hallway bucket',
    hearts: { count: 0, people: [], mine: false },
  }),
]

const line = (over: Partial<MealIngredient> = {}): MealIngredient => ({
  id: 'i-1',
  pantry_item_id: 'p-4',
  name: 'Lentils, red',
  unit: 'kg',
  amount: 1,
  bought: null,
  pantry: { where: 'Hallway bucket', stock_level: null, stock_amount: null },
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
  lead: { account_id: 'a-1', name: 'Ada' },
  helpers: [],
  cleanup: [],
  ingredients: [line()],
  ...over,
})

const staying = (over: Partial<MemberRosterEntry> = {}): MemberRosterEntry => ({
  id: 'at-1',
  event_id: 'e-1',
  account_id: 'a-1',
  joined_at: '2026-06-01T00:00:00.000Z',
  arrival_date: null,
  departure_date: null,
  lodging_option_id: null,
  helping_option_ids: [],
  helping_other: null,
  notes: null,
  payment_status: 'paid',
  name: 'Ada',
  avatar: null,
  contact: null,
  allergies_notes: null,
  allergy_items: [],
  lodging: null,
  helping: null,
  waiting: false,
  ...over,
})

const TWENTY = Array.from({ length: 20 }, (_, at) =>
  staying({
    id: `at-${at}`,
    account_id: `a-${at}`,
    joined_at: `2026-06-01T00:00:${String(at).padStart(2, '0')}.000Z`,
  }),
)

const stub = (
  over: Partial<ShoppingApi> = {},
  items: EventPantryItem[] = ITEMS,
  meals: Meal[] = [aMeal()],
  entries: MemberRosterEntry[] = TWENTY,
): ShoppingApi => ({
  getEventPantry: () => Promise.resolve({ items }),
  getMeals: () => Promise.resolve({ intro_markdown: '', slots: [], meals }),
  getMembers: () =>
    Promise.resolve({
      event: {
        id: 'e-1',
        name: 'Summer burn',
        member_cap: 42,
        payment_info_markdown: '',
        transfer_info_markdown: '',
      },
      entries,
    }),
  markPantryBought: () => Promise.reject(new Error('markPantryBought is not stubbed here')),
  unmarkPantryBought: () => Promise.reject(new Error('unmarkPantryBought is not stubbed here')),
  markIngredientBought: () => Promise.reject(new Error('markIngredientBought is not stubbed here')),
  unmarkIngredientBought: () => Promise.reject(new Error('unmarkIngredientBought is not stubbed here')),
  ...over,
})

const renderPage = (api: ShoppingApi, burn: MyBurn | null = BURN) =>
  render(
    <ViewerProvider viewer={MEMBER}>
      <BurnProvider
        value={{ status: 'ready', burns: burn === null ? [] : [burn], selected: burn ?? undefined }}
      >
        <Shopping api={api} />
      </BurnProvider>
    </ViewerProvider>,
  )

describe('the shopping list on a phone', () => {
  it('scales what a sitting asks for to the people there that day', async () => {
    onAPhone()
    renderPage(stub())

    expect(await screen.findByText('Lentils, red')).toBeTruthy()
    expect(screen.getByText('2 kg')).toBeTruthy()
    expect(screen.getByText('Sat 1 Dinner 2 kg · Ada')).toBeTruthy()
  })

  it('lists what is hearted with how many want it, what is in the house and where', async () => {
    onAPhone()
    renderPage(stub())

    expect(await screen.findByText('Oatmeal')).toBeTruthy()
    expect(screen.getByText('not counted · hallway, left white box')).toBeTruthy()
    expect(screen.getByText('14 want it')).toBeTruthy()
  })

  it('folds away what there is enough of, and unfolds it when asked', async () => {
    onAPhone()
    renderPage(stub())

    await screen.findByText('Oatmeal')
    expect(screen.queryByText('Rice')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Show the 1 thing there is enough of' }))

    expect(screen.getByText('Rice')).toBeTruthy()
  })

  it('keeps the bought ones apart, with who bought them', async () => {
    onAPhone()
    renderPage(stub())

    await screen.findByText('Oatmeal')

    expect(screen.getByRole('heading', { name: 'Bought' })).toBeTruthy()
    expect(screen.getByText(/^Bo · /)).toBeTruthy()
  })

  it('ticks a pantry thing off in the shop', async () => {
    onAPhone()
    const markPantryBought = vi.fn<ShoppingApi['markPantryBought']>(() => Promise.resolve(undefined))
    renderPage(stub({ markPantryBought }))

    fireEvent.click(await screen.findByLabelText('Bought Oatmeal'))

    await waitFor(() => expect(markPantryBought).toHaveBeenCalledWith('e-1', 'p-1'))
  })

  it('unticks one, which puts it back on the list', async () => {
    onAPhone()
    const unmarkPantryBought = vi.fn<ShoppingApi['unmarkPantryBought']>(() => Promise.resolve(undefined))
    renderPage(stub({ unmarkPantryBought }))

    fireEvent.click(await screen.findByLabelText('Bought Candles, tea lights'))

    await waitFor(() => expect(unmarkPantryBought).toHaveBeenCalledWith('e-1', 'p-3'))
  })
})

describe('what a cook asked for that the pantry does not stock', () => {
  const special = [
    aMeal({
      ingredients: [
        line({ id: 'i-2', pantry_item_id: null, name: 'Saffron', unit: 'pcs', amount: 1, pantry: null }),
      ],
    }),
    aMeal({
      id: 'm-2',
      date: '2026-08-02',
      label: 'Lunch',
      ingredients: [
        line({ id: 'i-3', pantry_item_id: null, name: 'saffron', unit: 'pcs', amount: 1, pantry: null }),
      ],
    }),
  ]

  it('lists it apart from the pantry, as the cook wrote it', async () => {
    onAPhone()
    renderPage(stub({}, ITEMS, special))

    expect(await screen.findByRole('heading', { name: 'Special for a meal' })).toBeTruthy()
    expect(screen.getByText('Saffron')).toBeTruthy()
  })

  it('ticks every line of the group off at once', async () => {
    onAPhone()
    const markIngredientBought = vi.fn<ShoppingApi['markIngredientBought']>(() => Promise.resolve(undefined))
    renderPage(stub({ markIngredientBought }, ITEMS, special))

    fireEvent.click(await screen.findByLabelText('Bought Saffron'))

    await waitFor(() => expect(markIngredientBought).toHaveBeenCalledTimes(2))
    expect(markIngredientBought.mock.calls).toEqual([['i-2'], ['i-3']])
  })
})

describe('buying for a number of your own', () => {
  it('replaces the headcount for every sitting', async () => {
    onAPhone()
    renderPage(stub())

    expect(await screen.findByText('2 kg')).toBeTruthy()

    fireEvent.input(screen.getByLabelText('Buying for how many people'), { target: { value: '40' } })

    expect(screen.getByText('4 kg')).toBeTruthy()
  })

  it('says how many have a place and how many are there each day', async () => {
    onAPhone()
    renderPage(stub())

    expect(await screen.findByText(/20 have a place; 20 here on Saturday 1\./)).toBeTruthy()
  })
})

describe('the shopping list on a wide screen', () => {
  it('lays the same list out as a table, with what is needed beside what to buy', async () => {
    onADesktop()
    renderPage(stub())

    expect(await screen.findByRole('rowheader', { name: 'Lentils, red' })).toBeTruthy()
    expect(screen.getAllByRole('columnheader', { name: 'Buy' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('cell', { name: '2 kg' })).toHaveLength(2)
  })

  it('has no table on a phone', async () => {
    onAPhone()
    renderPage(stub())

    await screen.findByText('Oatmeal')

    expect(screen.queryAllByRole('columnheader', { name: 'Buy' })).toEqual([])
  })
})

describe('the list as text', () => {
  it('carries the amounts', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    onAPhone()
    renderPage(stub())

    fireEvent.click(await screen.findByRole('button', { name: 'Copy as text' }))

    expect(writeText).toHaveBeenCalledWith(
      '- Lentils, red · 2 kg · Sat 1 Dinner 2 kg · Ada · Hallway bucket\n' +
        '- Oatmeal · 14 want it · hallway, left white box',
    )
  })
})

describe('with nothing to shop for', () => {
  it('says what fills the list', async () => {
    onAPhone()
    renderPage(stub({}, [], []))

    expect(await screen.findByText(/Nothing is waiting to be bought/)).toBeTruthy()
  })

  it('has nothing to shop for with no burn chosen', async () => {
    onAPhone()
    renderPage(stub(), null)

    expect(await screen.findByText(/there is nothing to shop for/)).toBeTruthy()
  })
})
