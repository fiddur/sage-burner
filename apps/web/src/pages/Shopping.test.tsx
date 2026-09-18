import type { EventPantryItem, MyBurn } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { ShoppingApi } from './Shopping.tsx'

import { BurnProvider } from '../burn.tsx'
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
    name: 'Cumin',
    kind: 'spice',
    where: '',
    hearts: { count: 0, people: [], mine: false },
  }),
]

const stub = (over: Partial<ShoppingApi> = {}, items: EventPantryItem[] = ITEMS): ShoppingApi => ({
  getEventPantry: () => Promise.resolve({ items }),
  markPantryBought: () => Promise.reject(new Error('markPantryBought is not stubbed here')),
  unmarkPantryBought: () => Promise.reject(new Error('unmarkPantryBought is not stubbed here')),
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

describe('the shopping list', () => {
  it('lists what is wanted with how many want it, what is in the house and where', async () => {
    renderPage(stub())

    expect(await screen.findByText('Oatmeal')).toBeTruthy()
    expect(screen.getByText('♥ 14 want it · not counted · hallway, left white box')).toBeTruthy()
  })

  it('leaves out what nobody has hearted', async () => {
    renderPage(stub())

    await screen.findByText('Oatmeal')

    expect(screen.queryByText('Cumin')).toBeNull()
  })

  it('folds away what there is enough of, and unfolds it when asked', async () => {
    renderPage(stub())

    await screen.findByText('Oatmeal')
    expect(screen.queryByText('Rice')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Show the 1 thing there is enough of' }))

    expect(screen.getByText('Rice')).toBeTruthy()
  })

  it('keeps the bought ones apart, with who bought them', async () => {
    renderPage(stub())

    await screen.findByText('Oatmeal')

    expect(screen.getByRole('heading', { name: 'Bought' })).toBeTruthy()
    expect(screen.getByText(/^Bo · /)).toBeTruthy()
  })

  it('ticks a thing off in the shop', async () => {
    const markPantryBought = vi.fn<ShoppingApi['markPantryBought']>(() => Promise.resolve(undefined))
    renderPage(stub({ markPantryBought }))

    fireEvent.click(await screen.findByLabelText('Bought Oatmeal'))

    await waitFor(() => expect(markPantryBought).toHaveBeenCalledWith('e-1', 'p-1'))
  })

  it('unticks one, which puts it back on the list', async () => {
    const unmarkPantryBought = vi.fn<ShoppingApi['unmarkPantryBought']>(() => Promise.resolve(undefined))
    renderPage(stub({ unmarkPantryBought }))

    fireEvent.click(await screen.findByLabelText('Bought Candles, tea lights'))

    await waitFor(() => expect(unmarkPantryBought).toHaveBeenCalledWith('e-1', 'p-3'))
  })

  it('offers the list as text to paste anywhere', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    renderPage(stub())

    fireEvent.click(await screen.findByRole('button', { name: 'Copy as text' }))

    expect(writeText).toHaveBeenCalledWith('- Oatmeal · 14 want it · hallway, left white box')
  })

  it('says what fills it when nothing is waiting to be bought', async () => {
    renderPage(stub({}, []))

    expect(await screen.findByText(/Nothing is waiting to be bought/)).toBeTruthy()
  })

  it('has nothing to shop for with no burn chosen', async () => {
    renderPage(stub(), null)

    expect(await screen.findByText(/there is nothing to shop for/)).toBeTruthy()
  })
})
