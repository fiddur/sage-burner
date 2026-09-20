import type { EventPantryItem, MyBurn, PantryItem, PantryPlace, SpecialBuy } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { LocationProvider } from 'preact-iso'
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
  note: '',
  places: [
    { place_id: 'pl-2', name: 'Hallway', spot: 'bucket' },
    { place_id: 'pl-3', name: 'Cellar', spot: 'I' },
  ],
  stock_level: null,
  stock_amount: null,
  counted_by: null,
  counted_by_name: null,
  counted_at: null,
  need_more: null,
  withdrawn_at: null,
  created_at: '2026-09-01T00:00:00.000Z',
  allergies: [],
  ...over,
})

const PLACES: PantryPlace[] = [
  { id: 'pl-1', order: 0, name: 'Kitchen' },
  { id: 'pl-2', order: 1, name: 'Hallway' },
  { id: 'pl-3', order: 2, name: 'Cellar' },
]

const ALLERGIES = [
  { id: 'al-1', order: 0, label: 'Nuts' },
  { id: 'al-2', order: 1, label: 'Gluten' },
]

const ITEMS: PantryItem[] = [
  thing(),
  thing({
    id: 'p-2',
    kind: 'spice',
    name: 'Cumin',
    unit: 'g',
    stock_level: 'plenty',
    places: [{ place_id: 'pl-1', name: 'Kitchen', spot: 'spice shelf' }],
  }),
  thing({
    id: 'p-3',
    kind: 'household',
    name: 'Toilet paper',
    unit: 'pkt',
    places: [{ place_id: 'pl-3', name: 'Cellar', spot: 'R10' }],
  }),
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
  getPantryPlaces: () => Promise.resolve({ places: PLACES }),
  putPantrySpot: () => Promise.reject(new Error('putPantrySpot is not stubbed here')),
  removePantrySpot: () => Promise.reject(new Error('removePantrySpot is not stubbed here')),
  getEventPantry: () =>
    Promise.resolve({
      items: [wanted(items[0] ?? thing(), 3, true), ...items.slice(1).map((one) => wanted(one, 0, false))],
    }),
  flagPantryNeedMore: () => Promise.reject(new Error('flagPantryNeedMore is not stubbed here')),
  unflagPantryNeedMore: () => Promise.reject(new Error('unflagPantryNeedMore is not stubbed here')),
  heartPantryItem: () => Promise.reject(new Error('heartPantryItem is not stubbed here')),
  unheartPantryItem: () => Promise.reject(new Error('unheartPantryItem is not stubbed here')),
  setPantryStock: () => Promise.reject(new Error('setPantryStock is not stubbed here')),
  addPantryItem: () => Promise.reject(new Error('addPantryItem is not stubbed here')),
  updatePantryItem: () => Promise.reject(new Error('updatePantryItem is not stubbed here')),
  withdrawPantryItem: () => Promise.reject(new Error('withdrawPantryItem is not stubbed here')),
  restorePantryItem: () => Promise.reject(new Error('restorePantryItem is not stubbed here')),
  getSpecialBuys: () => Promise.resolve({ buys: [] }),
  adoptSpecialBuy: () => Promise.reject(new Error('adoptSpecialBuy is not stubbed here')),
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

const renderPageAt = (at: string, api: PantryApi, viewer: Viewer = MEMBER) => {
  history.replaceState(null, '', at)

  return render(
    <LocationProvider>
      <RememberedProvider remembered={createRemembered()}>
        <ViewerProvider viewer={viewer}>
          <BurnProvider value={{ status: 'ready', burns: [], selected: undefined }}>
            <Pantry api={api} />
          </BurnProvider>
        </ViewerProvider>
      </RememberedProvider>
    </LocationProvider>,
  )
}

const counting = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Inventory management' }))
}

describe('the pantry page', () => {
  it('lists what the house has, with the rooms and boxes it lives in', async () => {
    renderPage(stub())

    expect(await screen.findByText('Oatmeal')).toBeTruthy()
    expect(screen.getByText('Hallway bucket · Cellar I')).toBeTruthy()
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
    await counting()

    fireEvent.click(screen.getAllByRole('button', { name: 'Out' })[0] ?? document.body)

    await waitFor(() => expect(setPantryStock).toHaveBeenCalledWith('p-1', { amount: null, level: 'out' }))
  })

  it('shows which answer is lit, and clears it when that one is pressed again', async () => {
    const setPantryStock = vi.fn(() => Promise.resolve({ item: thing({ id: 'p-2' }) }))
    renderPage(stub({ setPantryStock }))
    await counting()

    const lit = screen.getByRole('button', { name: 'Plenty', pressed: true })
    fireEvent.click(lit)

    await waitFor(() => expect(setPantryStock).toHaveBeenCalledWith('p-2', { amount: null, level: null }))
  })

  it('takes a rough amount beside some, saved on Enter', async () => {
    const setPantryStock = vi.fn(() => Promise.resolve({ item: thing({ stock_level: 'some' }) }))
    renderPage(stub({ setPantryStock }, [thing({ stock_amount: 1, stock_level: 'some' })]))
    await counting()

    const amount = screen.getByLabelText('How much Oatmeal, in kg')
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

    await counting()

    expect(screen.getByText(/Counted by Ada/)).toBeTruthy()
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

    await counting()

    expect(screen.getByText(/Counted by Someone without a name yet/)).toBeTruthy()
    expect(screen.getByText(/Counted by somebody who has left/)).toBeTruthy()
  })

  it('offers a member none of the admin controls, counting or not', async () => {
    renderPage(stub())
    await counting()

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
      expect(addPantryItem).toHaveBeenCalledWith({
        kind: 'staple',
        name: 'Rice',
        unit: 'kg',
        note: '',
        places: [],
      }),
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
    await counting()

    fireEvent.click(screen.getByLabelText('Edit Oatmeal'))
    fireEvent.input(screen.getByLabelText('Name, for Oatmeal'), { target: { value: 'Oats' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updatePantryItem).toHaveBeenCalledWith('p-1', {
        kind: 'breakfast',
        name: 'Oats',
        unit: 'kg',
        note: '',
        allergy_item_ids: [],
        places: [
          { place_id: 'pl-2', spot: 'bucket' },
          { place_id: 'pl-3', spot: 'I' },
        ],
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
    await counting()

    fireEvent.click(screen.getByLabelText('Edit Oatmeal'))
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
    await counting()

    fireEvent.click(screen.getByLabelText('Edit Oatmeal'))

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
    await counting()

    fireEvent.click(screen.getByLabelText('Take off Oatmeal'))
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

describe('the list as an overview, and counting as a mode', () => {
  it('keeps the counting controls out of the way until Inventory management is pressed', async () => {
    renderPage(stub())

    await screen.findByText('Oatmeal')
    expect(screen.queryByRole('button', { name: 'Out' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Ask for more Oatmeal' })).toBeNull()

    await counting()
    expect(screen.getAllByRole('button', { name: 'Out' }).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Ask for more Oatmeal' })).toBeTruthy()

    await counting()
    expect(screen.queryByRole('button', { name: 'Out' })).toBeNull()
  })

  it('keeps the pen and the bin inside the mode as well, for an admin', async () => {
    renderPage(stub(), ADMIN)

    await screen.findByText('Oatmeal')
    expect(screen.queryByLabelText('Edit Oatmeal')).toBeNull()
    expect(screen.queryByLabelText('Take off Oatmeal')).toBeNull()

    await counting()
    expect(screen.getByLabelText('Edit Oatmeal')).toBeTruthy()
    expect(screen.getByLabelText('Take off Oatmeal')).toBeTruthy()
  })

  it('says where a thing lives and how much is left, in words, on the row itself', async () => {
    renderPage(stub({}, [thing({ stock_level: 'some', stock_amount: 2 })]))

    expect(await screen.findByText('Hallway bucket · Cellar I · ~2 kg')).toBeTruthy()
  })

  it('names the answer alone where it carries no amount', async () => {
    renderPage(
      stub({}, [
        thing({ stock_level: 'plenty' }),
        thing({ id: 'p-2', name: 'Cumin', stock_level: 'out', places: [] }),
        thing({ id: 'p-3', name: 'Rice', stock_level: 'some', places: [] }),
      ]),
    )

    expect(await screen.findByText('Hallway bucket · Cellar I · plenty')).toBeTruthy()
    expect(screen.getByText('out')).toBeTruthy()
    expect(screen.getByText('some')).toBeTruthy()
  })

  it('says need more on that same line, and nothing at all for a thing nobody has counted', async () => {
    renderPage(
      stub({}, [
        thing({ places: [], need_more: { by: null, by_name: null, at: '2026-09-17T08:00:00.000Z' } }),
        thing({ id: 'p-2', name: 'Cumin', places: [] }),
      ]),
    )

    expect(await screen.findByText('need more')).toBeTruthy()
    expect(screen.getAllByRole('listitem')[1]?.textContent).toBe('CuminBreakfast')
  })

  it('keeps the box leading the row of a walk, with nothing else on it', async () => {
    renderPageAt('/pantry?place=pl-3', stub({}, [thing({ stock_level: 'out' })]))

    expect(await screen.findByLabelText('Write where Oatmeal is in the Cellar')).toBeTruthy()
    expect(screen.getByLabelText('Take Oatmeal out of the Cellar')).toBeTruthy()
    expect(screen.getByText('Hallway bucket · out')).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'How much Oatmeal is left' })).toBeNull()
  })
})

describe('a note on a pantry thing', () => {
  const noted = thing({ note: 'Dry weight. 0.09 kg becomes ca 2.5 dl/230 g' })

  it('is behind an icon on the row, in both modes, and only where there is one', async () => {
    renderPage(stub({}, [noted, thing({ id: 'p-2', name: 'Cumin' })]))

    expect(await screen.findByLabelText('About Oatmeal')).toBeTruthy()
    expect(screen.queryByLabelText('About Cumin')).toBeNull()

    await counting()
    expect(screen.getByLabelText('About Oatmeal')).toBeTruthy()
  })

  it('holds what was written about it', async () => {
    renderPage(stub({}, [noted]))

    await screen.findByLabelText('About Oatmeal')

    expect(screen.getByText('Dry weight. 0.09 kg becomes ca 2.5 dl/230 g')).toBeTruthy()
  })

  it('is written from the add form', async () => {
    const addPantryItem = vi.fn<PantryApi['addPantryItem']>(() => Promise.resolve({ item: noted }))
    renderPage(stub({ addPantryItem }), ADMIN)

    fireEvent.input(await screen.findByLabelText('What is it?'), { target: { value: 'Beans, black' } })
    fireEvent.input(screen.getByLabelText('Note'), { target: { value: '  Dry weight  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add it' }))

    await waitFor(() =>
      expect(addPantryItem).toHaveBeenCalledWith(expect.objectContaining({ note: 'Dry weight' })),
    )
  })

  it('is written from the pen, and starts from what the thing carries', async () => {
    const updatePantryItem = vi.fn<PantryApi['updatePantryItem']>(() => Promise.resolve({ item: noted }))
    renderPage(stub({ updatePantryItem }, [noted]), ADMIN)
    await counting()

    fireEvent.click(screen.getByLabelText('Edit Oatmeal'))
    expect(screen.getByLabelText('Note, for Oatmeal')).toHaveProperty(
      'value',
      'Dry weight. 0.09 kg becomes ca 2.5 dl/230 g',
    )

    fireEvent.input(screen.getByLabelText('Note, for Oatmeal'), { target: { value: 'Dry weight' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updatePantryItem).toHaveBeenCalledWith('p-1', expect.objectContaining({ note: 'Dry weight' })),
    )
  })
})

describe('asking for more of something from the cellar', () => {
  it('offers the ask on every row, burn or no burn', async () => {
    renderPage(stub())
    await counting()

    expect(screen.getByRole('button', { name: 'Ask for more Oatmeal' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ask for more Cumin' })).toBeTruthy()
  })

  it('writes the ask', async () => {
    const flagPantryNeedMore = vi.fn<PantryApi['flagPantryNeedMore']>(() => Promise.resolve(undefined))
    renderPage(stub({ flagPantryNeedMore }))
    await counting()

    fireEvent.click(screen.getByRole('button', { name: 'Ask for more Cumin' }))

    await waitFor(() => expect(flagPantryNeedMore).toHaveBeenCalledWith('p-2'))
  })

  it('lights the button and names who asked and when', async () => {
    renderPage(
      stub({}, [thing({ need_more: { by: 'a-9', by_name: 'Cleo', at: '2026-09-17T08:00:00.000Z' } })]),
    )

    await counting()
    const asked = screen.getByRole('button', { name: 'Stop asking for more Oatmeal' })

    expect(asked.className).toContain('is-on')
    expect(screen.getByText(/^Need more, asked by Cleo · /)).toBeTruthy()
  })

  it('names nobody where nobody asked, which is what an import leaves', async () => {
    renderPage(stub({}, [thing({ need_more: { by: null, by_name: null, at: '2026-09-17T08:00:00.000Z' } })]))
    await counting()

    expect(screen.getByText(/^Need more · /)).toBeTruthy()
  })

  it('takes the ask back when the lit button is pressed', async () => {
    const unflagPantryNeedMore = vi.fn<PantryApi['unflagPantryNeedMore']>(() => Promise.resolve(undefined))
    renderPage(
      stub({ unflagPantryNeedMore }, [
        thing({ need_more: { by: 'a-9', by_name: 'Cleo', at: '2026-09-17T08:00:00.000Z' } }),
      ]),
    )

    await counting()
    fireEvent.click(screen.getByRole('button', { name: 'Stop asking for more Oatmeal' }))

    await waitFor(() => expect(unflagPantryNeedMore).toHaveBeenCalledWith('p-1'))
  })

  it('keeps the ask out of the group that says how much is left', async () => {
    renderPage(stub())
    await counting()

    const group = screen.getByRole('group', { name: 'How much Oatmeal is left' })
    expect(group.textContent).toContain('Out')
    expect(group.textContent).not.toContain('Need more')
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

describe('taking inventory one room at a time', () => {
  const spread: PantryItem[] = [
    thing({
      id: 'p-1',
      name: 'Rice',
      places: [{ place_id: 'pl-3', name: 'Cellar', spot: 'R10' }],
    }),
    thing({
      id: 'p-2',
      name: 'Oats',
      places: [
        { place_id: 'pl-3', name: 'Cellar', spot: 'R2' },
        { place_id: 'pl-2', name: 'Hallway', spot: 'bucket' },
      ],
    }),
    thing({ id: 'p-3', name: 'Salt', places: [{ place_id: 'pl-3', name: 'Cellar', spot: '' }] }),
    thing({ id: 'p-4', name: 'Candles', places: [{ place_id: 'pl-1', name: 'Kitchen', spot: 'drawer' }] }),
  ]

  const walking = () => screen.getAllByRole('listitem').map((row) => row.textContent ?? '')

  it('shows only what is in the room, and puts the chip in the address', async () => {
    renderPageAt('/pantry?place=pl-3', stub({}, spread))

    await screen.findByText('Rice')
    expect(screen.queryByText('Candles')).toBeNull()
    expect(screen.getByRole('button', { name: 'Cellar' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('walks the room by box, counting the numbers and leaving the boxless last', async () => {
    renderPageAt('/pantry?place=pl-3', stub({}, spread))

    await screen.findByText('Oats')

    const order = walking()
    expect(order[0]).toContain('Oats')
    expect(order[1]).toContain('Rice')
    expect(order[2]).toContain('Salt')
  })

  it('narrows the walk by name as well', async () => {
    renderPageAt('/pantry?place=pl-3', stub({}, spread))

    fireEvent.input(await screen.findByLabelText('Find a thing'), { target: { value: 'oat' } })

    expect(screen.getByText('Oats')).toBeTruthy()
    expect(screen.queryByText('Rice')).toBeNull()
  })

  it('names the other rooms a thing is in, since this one is the box beside its name', async () => {
    renderPageAt('/pantry?place=pl-3', stub({}, spread))

    await screen.findByText('Oats')

    expect(screen.getByText('Hallway bucket')).toBeTruthy()
  })

  it('writes a box a member types in place', async () => {
    const putPantrySpot = vi.fn<PantryApi['putPantrySpot']>(() =>
      Promise.resolve({ item: spread[0] ?? thing() }),
    )
    renderPageAt('/pantry?place=pl-3', stub({ putPantrySpot }, spread))

    fireEvent.click(await screen.findByLabelText('Write where Rice is in the Cellar'))
    fireEvent.input(screen.getByLabelText('Where Rice is in the Cellar'), { target: { value: ' R3 ' } })
    fireEvent.keyDown(screen.getByLabelText('Where Rice is in the Cellar'), { key: 'Enter' })

    await waitFor(() => expect(putPantrySpot).toHaveBeenCalledWith('p-1', 'pl-3', { spot: 'R3' }))
  })

  it('takes a thing out of this room alone, never off the list', async () => {
    const removePantrySpot = vi.fn<PantryApi['removePantrySpot']>(() => Promise.resolve(undefined))
    renderPageAt('/pantry?place=pl-3', stub({ removePantrySpot }, spread))

    fireEvent.click(await screen.findByLabelText('Take Rice out of the Cellar'))

    await waitFor(() => expect(removePantrySpot).toHaveBeenCalledWith('p-1', 'pl-3'))
    expect(screen.queryByRole('button', { name: 'Really take off Rice' })).toBeNull()
  })

  it('offers the count and the ask on every row of the walk', async () => {
    renderPageAt('/pantry?place=pl-3', stub({}, spread))
    await counting()

    expect(screen.getByRole('group', { name: 'How much Rice is left' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ask for more Rice' })).toBeTruthy()
  })

  it('puts something found on the floor into the room, at the box it went into', async () => {
    const putPantrySpot = vi.fn<PantryApi['putPantrySpot']>(() =>
      Promise.resolve({ item: spread[3] ?? thing() }),
    )
    renderPageAt('/pantry?place=pl-3', stub({ putPantrySpot }, spread))

    fireEvent.input(await screen.findByLabelText('What did you find?'), { target: { value: 'cand' } })
    fireEvent.click(screen.getByRole('button', { name: /Candles/ }))
    fireEvent.input(screen.getByLabelText('Where Candles goes in the Cellar'), { target: { value: 'R4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Put it here' }))

    await waitFor(() => expect(putPantrySpot).toHaveBeenCalledWith('p-4', 'pl-3', { spot: 'R4' }))
  })

  it('offers only what is not in this room yet, and says where it is now', async () => {
    renderPageAt('/pantry?place=pl-3', stub({}, spread))

    fireEvent.input(await screen.findByLabelText('What did you find?'), { target: { value: 'a' } })

    const offered = document.querySelector('.ingredient-matches')?.textContent ?? ''
    expect(offered).toContain('Candles')
    expect(offered).toContain('Kitchen drawer')
    expect(offered).not.toContain('Salt')
  })

  it('does nothing on Enter in an empty box, which would otherwise pick the first thing', async () => {
    renderPageAt('/pantry?place=pl-3', stub({}, spread))

    const box = await screen.findByLabelText('What did you find?')
    fireEvent.keyDown(box, { key: 'Enter' })

    expect(screen.queryByRole('button', { name: 'Put it here' })).toBeNull()
  })

  it('tells a member to ask an admin for a thing that is on no list', async () => {
    renderPageAt('/pantry?place=pl-3', stub({}, spread))

    fireEvent.input(await screen.findByLabelText('What did you find?'), { target: { value: 'Quinoa' } })

    expect(screen.getByText(/Ask an admin/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Add a new thing/ })).toBeNull()
  })

  it('offers an admin the add form, filled in with the name and this room', async () => {
    renderPageAt('/pantry?place=pl-3', stub({}, spread), ADMIN)

    fireEvent.input(await screen.findByLabelText('What did you find?'), { target: { value: ' Quinoa ' } })
    fireEvent.click(screen.getByRole('button', { name: /Add a new thing/ }))

    expect((screen.getByLabelText('What is it?') as HTMLInputElement).value).toBe('Quinoa')
    expect((screen.getByLabelText('In the Cellar, for the new thing') as HTMLInputElement).checked).toBe(true)
  })

  it('adds a thing into the rooms an admin ticked', async () => {
    const addPantryItem = vi.fn<PantryApi['addPantryItem']>(() =>
      Promise.resolve({ item: thing({ id: 'p-9', name: 'Quinoa' }) }),
    )
    renderPage(stub({ addPantryItem }), ADMIN)

    fireEvent.input(await screen.findByLabelText('What is it?'), { target: { value: 'Quinoa' } })
    fireEvent.input(screen.getByLabelText('Which box in the Cellar, for the new thing'), {
      target: { value: 'R5' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add it' }))

    await waitFor(() =>
      expect(addPantryItem).toHaveBeenCalledWith({
        kind: 'staple',
        name: 'Quinoa',
        unit: 'pcs',
        note: '',
        places: [{ place_id: 'pl-3', spot: 'R5' }],
      }),
    )
  })

  it('takes a thing out of a room by unticking it in the pen', async () => {
    const updatePantryItem = vi.fn<PantryApi['updatePantryItem']>(() => Promise.resolve({ item: thing() }))
    renderPage(stub({ updatePantryItem }), ADMIN)
    await counting()

    fireEvent.click(screen.getByLabelText('Edit Oatmeal'))
    fireEvent.click(screen.getByLabelText('In the Cellar, for Oatmeal'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updatePantryItem).toHaveBeenCalledWith('p-1', {
        kind: 'breakfast',
        name: 'Oatmeal',
        unit: 'kg',
        note: '',
        allergy_item_ids: [],
        places: [{ place_id: 'pl-2', spot: 'bucket' }],
      }),
    )
  })

  it('leaves the ordinary list alone where no room is chosen', async () => {
    renderPageAt('/pantry', stub({}, spread))

    expect(await screen.findByText('Candles')).toBeTruthy()
    expect(screen.queryByLabelText('What did you find?')).toBeNull()
  })
})

const LINES = [
  { id: 'li-1', amount: 1, meal_label: 'Dinner', date: '2026-08-01', event_name: 'Autumn burn' },
  { id: 'li-2', amount: null, meal_label: 'Lunch', date: '2026-08-02', event_name: 'Autumn burn' },
  { id: 'li-3', amount: 4, meal_label: 'Dinner', date: '2026-08-02', event_name: 'Autumn burn' },
]

const SAFFRON: SpecialBuy = {
  name: 'Saffron, 1 g sachets',
  unit: 'sachets',
  sittings: 3,
  sample: { meal_label: 'Dinner', date: '2026-08-01', event_name: 'Autumn burn' },
  lines: LINES,
}

const promoting = (over: Partial<PantryApi> = {}, buys: SpecialBuy[] = [SAFFRON]) =>
  stub({ getSpecialBuys: () => Promise.resolve({ buys }), ...over })

describe('promoting a special buy', () => {
  it('lists what cooks keep writing by hand, with how often and where', async () => {
    renderPage(promoting(), ADMIN)

    expect(await screen.findByText('Saffron, 1 g sachets')).toBeTruthy()
    expect(screen.getByText('3 sittings · Autumn burn: Sat 1 Dinner')).toBeTruthy()
  })

  it('is absent when there is nothing to promote', async () => {
    renderPage(promoting({}, []), ADMIN)

    await screen.findByText('Oatmeal')

    expect(screen.queryByText('Written on sittings, not in the pantry')).toBeNull()
  })

  it('is not offered to a member, who may not read it either', async () => {
    const getSpecialBuys = vi.fn<PantryApi['getSpecialBuys']>(() => Promise.resolve({ buys: [SAFFRON] }))
    renderPage(promoting({ getSpecialBuys }), MEMBER)

    await screen.findByText('Oatmeal')

    expect(screen.queryByText('Written on sittings, not in the pantry')).toBeNull()
    expect(getSpecialBuys).not.toHaveBeenCalled()
  })

  it('fills the add form in with what was written, and says what saving will do', async () => {
    renderPage(promoting(), ADMIN)

    fireEvent.click(await screen.findByLabelText('Promote Saffron, 1 g sachets to the pantry'))

    expect(screen.getByLabelText('What is it?')).toHaveProperty('value', 'Saffron, 1 g sachets')
    expect(screen.getByLabelText('Counted in')).toHaveProperty('value', 'sachets')
    expect(screen.getByText(/points every line written/)).toBeTruthy()
  })

  it('adds the thing and then points the lines at it, saying how many followed', async () => {
    const addPantryItem = vi.fn<PantryApi['addPantryItem']>(() =>
      Promise.resolve({ item: thing({ id: 'p-9', name: 'Saffron, 1 g sachets', unit: 'sachets' }) }),
    )
    const adoptSpecialBuy = vi.fn<PantryApi['adoptSpecialBuy']>(() => Promise.resolve({ adopted: 3 }))
    renderPage(promoting({ addPantryItem, adoptSpecialBuy }), ADMIN)

    fireEvent.click(await screen.findByLabelText('Promote Saffron, 1 g sachets to the pantry'))
    fireEvent.click(screen.getByRole('button', { name: 'Add it' }))

    await waitFor(() =>
      expect(adoptSpecialBuy).toHaveBeenCalledWith('p-9', {
        name: 'Saffron, 1 g sachets',
        unit: 'sachets',
        amounts: {},
      }),
    )
    expect(addPantryItem).toHaveBeenCalledWith({
      kind: 'staple',
      name: 'Saffron, 1 g sachets',
      unit: 'sachets',
      note: '',
      places: [],
    })
    expect(await screen.findByText('3 lines now point at the pantry.')).toBeTruthy()
  })

  it('asks what each line becomes before saving, once the unit has been changed', async () => {
    const addPantryItem = vi.fn<PantryApi['addPantryItem']>(() =>
      Promise.resolve({ item: thing({ id: 'p-9', name: 'Saffron, 1 g sachets' }) }),
    )
    renderPage(promoting({ addPantryItem }), ADMIN)

    fireEvent.click(await screen.findByLabelText('Promote Saffron, 1 g sachets to the pantry'))
    fireEvent.input(screen.getByLabelText('Counted in'), { target: { value: 'g' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add it' }))

    expect(screen.getByText('Adjust the amounts')).toBeTruthy()
    expect(addPantryItem).not.toHaveBeenCalled()
    expect(
      screen.getByLabelText('How much Saffron, 1 g sachets on Autumn burn: Sat 1 Dinner, in g'),
    ).toHaveProperty('value', '1')
    expect(
      screen.getByLabelText('How much Saffron, 1 g sachets on Autumn burn: Sun 2 Lunch, in g'),
    ).toHaveProperty('value', '')
    expect(screen.getByText(/Autumn burn: Sun 2 Lunch · to taste/)).toBeTruthy()
  })

  it('sends what was typed against each line, an emptied box meaning no amount', async () => {
    const addPantryItem = vi.fn<PantryApi['addPantryItem']>(() =>
      Promise.resolve({ item: thing({ id: 'p-9', name: 'Saffron, 1 g sachets' }) }),
    )
    const adoptSpecialBuy = vi.fn<PantryApi['adoptSpecialBuy']>(() => Promise.resolve({ adopted: 3 }))
    renderPage(promoting({ addPantryItem, adoptSpecialBuy }), ADMIN)

    fireEvent.click(await screen.findByLabelText('Promote Saffron, 1 g sachets to the pantry'))
    fireEvent.input(screen.getByLabelText('Counted in'), { target: { value: 'g' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add it' }))
    fireEvent.input(
      screen.getByLabelText('How much Saffron, 1 g sachets on Autumn burn: Sat 1 Dinner, in g'),
      {
        target: { value: '2' },
      },
    )
    fireEvent.input(
      screen.getByLabelText('How much Saffron, 1 g sachets on Autumn burn: Sun 2 Lunch, in g'),
      {
        target: { value: '3' },
      },
    )
    fireEvent.input(
      screen.getByLabelText('How much Saffron, 1 g sachets on Autumn burn: Sun 2 Dinner, in g'),
      {
        target: { value: '' },
      },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Promote' }))

    await waitFor(() =>
      expect(adoptSpecialBuy).toHaveBeenCalledWith('p-9', {
        name: 'Saffron, 1 g sachets',
        unit: 'sachets',
        amounts: { 'li-1': 2, 'li-2': 3, 'li-3': null },
      }),
    )
    expect(addPantryItem).toHaveBeenCalledWith(expect.objectContaining({ unit: 'g' }))
    expect(await screen.findByText('3 lines now point at the pantry.')).toBeTruthy()
  })

  it('comes back from the step with what was filled in still there', async () => {
    renderPage(promoting(), ADMIN)

    fireEvent.click(await screen.findByLabelText('Promote Saffron, 1 g sachets to the pantry'))
    fireEvent.input(screen.getByLabelText('Counted in'), { target: { value: 'g' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add it' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect(screen.queryByText('Adjust the amounts')).toBeNull()
    expect(screen.getByLabelText('What is it?')).toHaveProperty('value', 'Saffron, 1 g sachets')
    expect(screen.getByLabelText('Counted in')).toHaveProperty('value', 'g')
    expect(screen.getByRole('button', { name: 'Add it' })).toBeTruthy()
  })

  it('sends no amounts when the unit is put back inside the adjust step itself', async () => {
    const adoptSpecialBuy = vi.fn<PantryApi['adoptSpecialBuy']>(() => Promise.resolve({ adopted: 3 }))
    renderPage(
      promoting({
        addPantryItem: () => Promise.resolve({ item: thing({ id: 'p-9', name: 'Saffron, 1 g sachets' }) }),
        adoptSpecialBuy,
      }),
      ADMIN,
    )

    fireEvent.click(await screen.findByLabelText('Promote Saffron, 1 g sachets to the pantry'))
    fireEvent.input(screen.getByLabelText('Counted in'), { target: { value: 'g' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add it' }))
    fireEvent.input(
      screen.getByLabelText('How much Saffron, 1 g sachets on Autumn burn: Sat 1 Dinner, in g'),
      { target: { value: '2' } },
    )
    fireEvent.input(screen.getByLabelText('Counted in'), { target: { value: 'Sachets' } })
    fireEvent.click(screen.getByRole('button', { name: 'Promote' }))

    await waitFor(() =>
      expect(adoptSpecialBuy).toHaveBeenCalledWith('p-9', {
        name: 'Saffron, 1 g sachets',
        unit: 'sachets',
        amounts: {},
      }),
    )
  })

  it('forgets the amounts once the unit is put back, since nothing is being converted', async () => {
    const adoptSpecialBuy = vi.fn<PantryApi['adoptSpecialBuy']>(() => Promise.resolve({ adopted: 3 }))
    renderPage(
      promoting({
        addPantryItem: () => Promise.resolve({ item: thing({ id: 'p-9', name: 'Saffron, 1 g sachets' }) }),
        adoptSpecialBuy,
      }),
      ADMIN,
    )

    fireEvent.click(await screen.findByLabelText('Promote Saffron, 1 g sachets to the pantry'))
    fireEvent.input(screen.getByLabelText('Counted in'), { target: { value: 'g' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add it' }))
    fireEvent.input(
      screen.getByLabelText('How much Saffron, 1 g sachets on Autumn burn: Sat 1 Dinner, in g'),
      {
        target: { value: '2' },
      },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    fireEvent.input(screen.getByLabelText('Counted in'), { target: { value: 'sachets' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add it' }))

    await waitFor(() =>
      expect(adoptSpecialBuy).toHaveBeenCalledWith('p-9', {
        name: 'Saffron, 1 g sachets',
        unit: 'sachets',
        amounts: {},
      }),
    )
  })

  it('adds an ordinary thing without asking for any adoption', async () => {
    const adoptSpecialBuy = vi.fn<PantryApi['adoptSpecialBuy']>(() => Promise.resolve({ adopted: 0 }))
    const addPantryItem = vi.fn<PantryApi['addPantryItem']>(() => Promise.resolve({ item: thing() }))
    renderPage(promoting({ addPantryItem, adoptSpecialBuy }), ADMIN)

    fireEvent.input(await screen.findByLabelText('What is it?'), { target: { value: 'Quinoa' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add it' }))

    await waitFor(() => expect(addPantryItem).toHaveBeenCalled())
    expect(adoptSpecialBuy).not.toHaveBeenCalled()
  })
})
