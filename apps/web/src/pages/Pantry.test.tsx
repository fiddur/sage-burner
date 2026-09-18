import type { EventPantryItem, MyBurn, PantryItem } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { PantryApi } from './Pantry.tsx'

import { apiError } from '../api/client.ts'
import { BurnProvider } from '../burn.tsx'
import { createRemembered, RememberedProvider } from '../remembered.tsx'
import { ViewerProvider } from '../viewer.tsx'
import { Pantry } from './Pantry.tsx'

afterEach(cleanup)

const MEMBER: Viewer = {
  status: 'signed-in',
  account: { id: 'a-1', name: 'Ada', avatar: null, roles: ['member'] },
}

const ADMIN: Viewer = {
  status: 'signed-in',
  account: { id: 'a-2', name: 'Bo', avatar: null, roles: ['admin', 'member'] },
}

const thing = (over: Partial<PantryItem> = {}): PantryItem => ({
  id: 'p-1',
  kind: 'breakfast',
  name: 'Oatmeal',
  unit: 'kg',
  where: 'Hallway bucket · cellar I',
  stock_level: null,
  stock_amount: null,
  counted_by: null,
  counted_by_name: null,
  counted_at: null,
  withdrawn_at: null,
  created_at: '2026-09-01T00:00:00.000Z',
  allergies: [],
  ...over,
})

const ALLERGIES = [
  { id: 'al-1', order: 0, label: 'Nuts' },
  { id: 'al-2', order: 1, label: 'Gluten' },
]

const ITEMS: PantryItem[] = [
  thing(),
  thing({ id: 'p-2', kind: 'spice', name: 'Cumin', unit: 'g', stock_level: 'plenty', where: 'Spice shelf' }),
  thing({ id: 'p-3', kind: 'household', name: 'Toilet paper', unit: 'pkt', where: 'Cellar II' }),
]

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

const wanted = (item: PantryItem, count: number, mine: boolean): EventPantryItem => ({
  ...item,
  hearts: { count, people: [], mine },
  bought: null,
})

const stub = (over: Partial<PantryApi> = {}, items: PantryItem[] = ITEMS): PantryApi => ({
  getPantry: () => Promise.resolve({ items }),
  getAllergyItems: () => Promise.resolve({ items: ALLERGIES }),
  getEventPantry: () =>
    Promise.resolve({
      items: [wanted(items[0] ?? thing(), 3, true), ...items.slice(1).map((one) => wanted(one, 0, false))],
    }),
  heartPantryItem: () => Promise.reject(new Error('heartPantryItem is not stubbed here')),
  unheartPantryItem: () => Promise.reject(new Error('unheartPantryItem is not stubbed here')),
  setPantryStock: () => Promise.reject(new Error('setPantryStock is not stubbed here')),
  addPantryItem: () => Promise.reject(new Error('addPantryItem is not stubbed here')),
  updatePantryItem: () => Promise.reject(new Error('updatePantryItem is not stubbed here')),
  withdrawPantryItem: () => Promise.reject(new Error('withdrawPantryItem is not stubbed here')),
  restorePantryItem: () => Promise.reject(new Error('restorePantryItem is not stubbed here')),
  ...over,
})

const renderPage = (api: PantryApi, viewer: Viewer = MEMBER, burn?: MyBurn) =>
  render(
    <RememberedProvider remembered={createRemembered()}>
      <ViewerProvider viewer={viewer}>
        <BurnProvider value={{ status: 'ready', burns: burn === undefined ? [] : [burn], selected: burn }}>
          <Pantry api={api} />
        </BurnProvider>
      </ViewerProvider>
    </RememberedProvider>,
  )

describe('the pantry page', () => {
  it('lists what the house has, with where it lives', async () => {
    renderPage(stub())

    expect(await screen.findByText('Oatmeal')).toBeTruthy()
    expect(screen.getByText('Hallway bucket · cellar I')).toBeTruthy()
  })

  it('filters by name as you type', async () => {
    renderPage(stub())

    fireEvent.input(await screen.findByLabelText('Find a thing'), { target: { value: 'cum' } })

    expect(screen.getByText('Cumin')).toBeTruthy()
    expect(screen.queryByText('Oatmeal')).toBeNull()
  })

  it('filters by kind', async () => {
    renderPage(stub())

    fireEvent.click(await screen.findByRole('button', { name: 'Spices' }))

    expect(screen.getByText('Cumin')).toBeTruthy()
    expect(screen.queryByText('Toilet paper')).toBeNull()
  })

  it('shows what nobody has counted, which is what a round of counting starts from', async () => {
    renderPage(stub())

    fireEvent.click(await screen.findByRole('button', { name: 'Not counted' }))

    expect(screen.getByText('Oatmeal')).toBeTruthy()
    expect(screen.queryByText('Cumin')).toBeNull()
  })

  it('counts a thing in one tap', async () => {
    const setPantryStock = vi.fn(() => Promise.resolve({ item: thing({ stock_level: 'out' }) }))
    renderPage(stub({ setPantryStock }))

    fireEvent.click((await screen.findAllByRole('button', { name: 'Out' }))[0] ?? document.body)

    await waitFor(() => expect(setPantryStock).toHaveBeenCalledWith('p-1', { amount: null, level: 'out' }))
  })

  it('shows which answer is lit, and clears it when that one is pressed again', async () => {
    const setPantryStock = vi.fn(() => Promise.resolve({ item: thing({ id: 'p-2' }) }))
    renderPage(stub({ setPantryStock }))

    const lit = await screen.findByRole('button', { name: 'Plenty', pressed: true })
    fireEvent.click(lit)

    await waitFor(() => expect(setPantryStock).toHaveBeenCalledWith('p-2', { amount: null, level: null }))
  })

  it('takes a rough amount beside some, saved on Enter', async () => {
    const setPantryStock = vi.fn(() => Promise.resolve({ item: thing({ stock_level: 'some' }) }))
    renderPage(stub({ setPantryStock }, [thing({ stock_amount: 1, stock_level: 'some' })]))

    const amount = await screen.findByLabelText('How much Oatmeal, in kg')
    fireEvent.input(amount, { target: { value: '2.5' } })
    fireEvent.keyDown(amount, { key: 'Enter' })

    await waitFor(() => expect(setPantryStock).toHaveBeenCalledWith('p-1', { amount: 2.5, level: 'some' }))
  })

  it('says who counted it and when', async () => {
    renderPage(
      stub({}, [
        thing({
          counted_at: '2026-09-17T18:30:00.000Z',
          counted_by: 'a-1',
          counted_by_name: 'Ada',
          stock_level: 'plenty',
        }),
      ]),
    )

    expect(await screen.findByText(/Counted by Ada/)).toBeTruthy()
  })

  it('tells an account with no name yet apart from one that has left', async () => {
    renderPage(
      stub({}, [
        thing({
          counted_at: '2026-09-17T18:30:00.000Z',
          counted_by: 'a-9',
          counted_by_name: null,
          stock_level: 'out',
        }),
        thing({
          id: 'p-2',
          name: 'Cumin',
          counted_at: '2026-09-17T18:30:00.000Z',
          counted_by: null,
          counted_by_name: null,
          stock_level: 'out',
        }),
      ]),
    )

    expect(await screen.findByText(/Counted by Someone without a name yet/)).toBeTruthy()
    expect(screen.getByText(/Counted by somebody who has left/)).toBeTruthy()
  })

  it('offers a member none of the admin controls', async () => {
    renderPage(stub())

    await screen.findByText('Oatmeal')

    expect(screen.queryByRole('button', { name: 'Add it' })).toBeNull()
    expect(screen.queryByLabelText('Edit Oatmeal')).toBeNull()
    expect(screen.queryByLabelText('Take off Oatmeal')).toBeNull()
  })

  it('lets an admin add a thing', async () => {
    const addPantryItem = vi.fn(() => Promise.resolve({ item: thing({ id: 'p-4', name: 'Rice' }) }))
    renderPage(stub({ addPantryItem }), ADMIN)

    fireEvent.input(await screen.findByLabelText('What is it?'), { target: { value: '  Rice ' } })
    fireEvent.change(screen.getByLabelText('What kind of thing?'), { target: { value: 'staple' } })
    fireEvent.input(screen.getByLabelText('Counted in'), { target: { value: 'kg' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add it' }))

    await waitFor(() =>
      expect(addPantryItem).toHaveBeenCalledWith({ kind: 'staple', name: 'Rice', unit: 'kg', where: '' }),
    )
  })

  it('says what a name already taken means, rather than "could not add that"', async () => {
    renderPage(
      stub({ addPantryItem: () => Promise.reject(apiError(409, 'conflict', 'Request failed (409).')) }),
      ADMIN,
    )

    fireEvent.input(await screen.findByLabelText('What is it?'), { target: { value: 'Oatmeal' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add it' }))

    expect(await screen.findByText(/already called that/)).toBeTruthy()
  })

  it('lets an admin edit one in place', async () => {
    const updatePantryItem = vi.fn(() => Promise.resolve({ item: thing({ name: 'Oats' }) }))
    renderPage(stub({ updatePantryItem }), ADMIN)

    fireEvent.click(await screen.findByLabelText('Edit Oatmeal'))
    fireEvent.input(screen.getByLabelText('Name, for Oatmeal'), { target: { value: 'Oats' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updatePantryItem).toHaveBeenCalledWith('p-1', {
        kind: 'breakfast',
        name: 'Oats',
        unit: 'kg',
        where: 'Hallway bucket · cellar I',
        allergy_item_ids: [],
      }),
    )
  })

  it('shows what a thing contains beside its name, so the cook sees it while browsing', async () => {
    renderPage(stub({}, [thing({ allergies: [{ id: 'al-1', label: 'Nuts' }] })]))

    expect(await screen.findByText('Nuts')).toBeTruthy()
  })

  it('lets an admin tick what a thing contains, out of the allergy vocabulary', async () => {
    const updatePantryItem = vi.fn(() => Promise.resolve({ item: thing() }))
    renderPage(stub({ updatePantryItem }), ADMIN)

    fireEvent.click(await screen.findByLabelText('Edit Oatmeal'))
    fireEvent.click(screen.getByRole('button', { name: 'Gluten' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updatePantryItem).toHaveBeenCalledWith(
        'p-1',
        expect.objectContaining({ allergy_item_ids: ['al-2'] }),
      ),
    )
  })

  it('starts the ticks from what the thing already carries, and untick takes one off', async () => {
    const updatePantryItem = vi.fn(() => Promise.resolve({ item: thing() }))
    renderPage(stub({ updatePantryItem }, [thing({ allergies: [{ id: 'al-1', label: 'Nuts' }] })]), ADMIN)

    fireEvent.click(await screen.findByLabelText('Edit Oatmeal'))

    expect(screen.getByRole('button', { name: 'Nuts' }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Nuts' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updatePantryItem).toHaveBeenCalledWith('p-1', expect.objectContaining({ allergy_item_ids: [] })),
    )
  })

  it('offers a member no ticking at all', async () => {
    renderPage(stub({}, [thing({ allergies: [{ id: 'al-1', label: 'Nuts' }] })]))

    expect(await screen.findByText('Nuts')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Gluten' })).toBeNull()
  })

  it('asks before taking one off', async () => {
    const withdrawPantryItem = vi.fn(() => Promise.resolve(undefined))
    renderPage(stub({ withdrawPantryItem }), ADMIN)

    fireEvent.click(await screen.findByLabelText('Take off Oatmeal'))
    fireEvent.click(screen.getByRole('button', { name: 'Really take off Oatmeal' }))

    await waitFor(() => expect(withdrawPantryItem).toHaveBeenCalledWith('p-1'))
  })

  it('keeps what was taken off out of the list, and under its own heading for an admin', async () => {
    const taken = [thing(), thing({ id: 'p-9', name: 'Marmite', withdrawn_at: '2026-09-10T00:00:00.000Z' })]

    const asMember = renderPage(stub({}, taken))
    await screen.findByText('Oatmeal')
    expect(screen.queryByText('Marmite')).toBeNull()
    expect(screen.queryByText('Taken off')).toBeNull()
    asMember.unmount()

    renderPage(stub({}, taken), ADMIN)

    expect(await screen.findByText('Taken off')).toBeTruthy()
    expect(screen.getByLabelText('Put Marmite back on the list')).toBeTruthy()
  })

  it('puts one back', async () => {
    const restorePantryItem = vi.fn(() => Promise.resolve({ item: thing({ id: 'p-9', name: 'Marmite' }) }))
    renderPage(
      stub({ restorePantryItem }, [
        thing({ id: 'p-9', name: 'Marmite', withdrawn_at: '2026-09-10T00:00:00.000Z' }),
      ]),
      ADMIN,
    )

    fireEvent.click(await screen.findByLabelText('Put Marmite back on the list'))

    await waitFor(() => expect(restorePantryItem).toHaveBeenCalledWith('p-9'))
  })
})

describe('hearting from the pantry, where the rarer things are', () => {
  it('offers a heart on every row once a burn is chosen', async () => {
    renderPage(stub(), MEMBER, BURN)

    expect(await screen.findByRole('button', { name: 'Take back your heart for Oatmeal' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Give a heart to Cumin' })).toBeTruthy()
  })

  it('offers none at all with no burn to want anything at', async () => {
    renderPage(stub())

    await screen.findByText('Oatmeal')

    expect(screen.queryByRole('button', { name: 'Give a heart to Cumin' })).toBeNull()
  })

  it('hearts a spice nobody would list on the Meals page', async () => {
    const heartPantryItem = vi.fn<PantryApi['heartPantryItem']>(() => Promise.resolve(undefined))
    renderPage(stub({ heartPantryItem }), MEMBER, BURN)

    fireEvent.click(await screen.findByRole('button', { name: 'Give a heart to Cumin' }))

    await waitFor(() => expect(heartPantryItem).toHaveBeenCalledWith('e-1', 'p-2'))
  })
})
