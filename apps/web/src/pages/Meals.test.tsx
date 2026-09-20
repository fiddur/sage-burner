import type { EventPantryItem, Meal, MyBurn } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { MealsApi } from './Meals.tsx'

import { apiError } from '../api/client.ts'
import { BurnProvider } from '../burn.tsx'
import { ViewerProvider } from '../viewer.tsx'
import { Meals } from './Meals.tsx'

afterEach(cleanup)

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

const aMeal = (over: Partial<Meal> = {}): Meal => ({
  id: 'm-1',
  event_id: 'e-1',
  date: '2026-08-01',
  at: '18:00',
  label: 'Dinner',
  kind: 'meal',
  food_idea: '',
  serves: 1,
  lead: null,
  helpers: [],
  cleanup: [],
  ingredients: [],
  ...over,
})

const aThing = (over: Partial<EventPantryItem> = {}): EventPantryItem => ({
  id: 'p-1',
  kind: 'breakfast',
  name: 'Oatmeal',
  unit: 'kg',
  note: '',
  places: [],
  stock_level: null,
  stock_amount: null,
  counted_by: null,
  counted_by_name: null,
  counted_at: null,
  need_more: null,
  withdrawn_at: null,
  created_at: '2026-07-01T00:00:00.000Z',
  allergies: [],
  hearts: { count: 0, people: [], mine: false },
  bought: null,
  ...over,
})

const PANTRY: EventPantryItem[] = [
  aThing({ id: 'p-1', name: 'Oatmeal', hearts: { count: 2, people: [], mine: true } }),
  aThing({ id: 'p-2', name: 'Berries, frozen', hearts: { count: 9, people: [], mine: false } }),
  aThing({ id: 'p-3', kind: 'snack', name: 'Dates' }),
  aThing({ id: 'p-4', kind: 'household', name: 'Toilet paper' }),
  aThing({ id: 'p-5', kind: 'staple', name: 'Rice' }),
]

const stub = (
  over: Partial<MealsApi> = {},
  meals: Meal[] = [aMeal()],
  pantry: EventPantryItem[] = PANTRY,
): MealsApi => ({
  getEventPantry: () => Promise.resolve({ items: pantry }),
  heartPantryItem: () => Promise.reject(new Error('heartPantryItem is not stubbed here')),
  unheartPantryItem: () => Promise.reject(new Error('unheartPantryItem is not stubbed here')),
  getMeals: () =>
    Promise.resolve({
      intro_markdown: '',
      slots: [{ id: 's-1', event_id: 'e-1', order: 0, label: 'Dinner', at: '18:00', kind: 'meal' }],
      meals,
    }),
  getEventAttendees: () =>
    Promise.resolve({
      attendees: [
        { account_id: 'a-1', name: 'Ada', avatar: null },
        { account_id: 'a-2', name: 'Bea', avatar: null },
      ],
    }),
  setMealLead: () => Promise.reject(new Error('setMealLead is not stubbed here')),
  uploadImage: () => Promise.reject(new Error('uploadImage is not stubbed here')),
  joinMealCrew: () => Promise.reject(new Error('joinMealCrew is not stubbed here')),
  leaveMealCrew: () => Promise.reject(new Error('leaveMealCrew is not stubbed here')),
  setMealIdea: () => Promise.reject(new Error('setMealIdea is not stubbed here')),
  updateMealIntro: () => Promise.reject(new Error('updateMealIntro is not stubbed here')),
  ...over,
})

const renderPage = (api: MealsApi, burn: MyBurn | null = BURN) =>
  render(
    <ViewerProvider viewer={MEMBER}>
      <BurnProvider
        value={{ status: 'ready', burns: burn === null ? [] : [burn], selected: burn ?? undefined }}
      >
        <Meals api={api} />
      </BurnProvider>
    </ViewerProvider>,
  )

describe('the meal plan', () => {
  it('shows a sitting with its time', async () => {
    renderPage(stub())

    expect(await screen.findByText('Dinner')).toBeTruthy()
    expect(screen.getByText('18:00')).toBeTruthy()
  })

  it('gives the sitting one column and what is cooked another', async () => {
    renderPage(stub())

    await screen.findByText('Dinner')

    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Meal',
      'Food',
      'Lead',
      'Help',
      'Cleanup',
    ])
  })

  it('stacks the day and the time in the first cell, short enough to sit in it', async () => {
    renderPage(stub())

    const when = await screen.findByRole('rowheader')

    expect(when.textContent).toBe('Sat 118:00')
  })

  it('repeats the time but not the day, like the sheet’s merged cells', async () => {
    renderPage(
      stub({}, [
        aMeal({ id: 'm-1', at: '08:00', label: 'Breakfast' }),
        aMeal({ id: 'm-2', at: '18:00', label: 'Dinner' }),
        aMeal({ id: 'm-3', date: '2026-08-02', at: '08:00', label: 'Breakfast' }),
      ]),
    )

    await screen.findByText('Dinner')

    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
      'Sat 108:00',
      '18:00',
      'Sun 208:00',
    ])
  })

  it('takes the lead for somebody', async () => {
    const setMealLead = vi.fn<MealsApi['setMealLead']>(() => Promise.resolve({ meal: aMeal() }))
    renderPage(stub({ setMealLead }))

    fireEvent.click(await screen.findByRole('button', { name: 'Take the spot on Dinner on 2026-08-01' }))

    await waitFor(() => expect(setMealLead).toHaveBeenCalledWith('m-1', { account_id: 'a-1' }))
  })

  it('stands for the cleanup crew', async () => {
    const joinMealCrew = vi.fn<MealsApi['joinMealCrew']>(() => Promise.resolve({ meal: aMeal() }))
    renderPage(stub({ joinMealCrew }))

    fireEvent.click(
      await screen.findByRole('button', { name: 'Take the spot on cleanup at Dinner on 2026-08-01' }),
    )

    await waitFor(() => expect(joinMealCrew).toHaveBeenCalledWith('m-1', 'cleanup', { account_id: 'a-1' }))
  })

  it('writes a food idea when the field is left, not on every keystroke', async () => {
    const setMealIdea = vi.fn<MealsApi['setMealIdea']>(() => Promise.resolve({ meal: aMeal() }))
    renderPage(stub({ setMealIdea }))

    const field = await screen.findByLabelText('Food idea for Dinner on 2026-08-01')
    fireEvent.input(field, { target: { value: 'Vegan bolognese' } })
    expect(setMealIdea).not.toHaveBeenCalled()

    fireEvent.blur(field)

    await waitFor(() => expect(setMealIdea).toHaveBeenCalledWith('m-1', { food_idea: 'Vegan bolognese' }))
  })

  it('leads to the sitting itself, where what it takes is written', async () => {
    renderPage(stub({}, [aMeal()]))

    const link = await screen.findByRole('link', { name: 'Ingredients' })

    expect(link.getAttribute('href')).toBe('/schedule?burn=e-1&meal=m-1')
  })

  it('counts what is written there already', async () => {
    renderPage(
      stub({}, [
        aMeal({
          ingredients: [
            {
              id: 'i-1',
              pantry_item_id: 'p-1',
              name: 'Rice, basmati',
              unit: 'kg',
              amount: 1.2,
              bought: null,
              pantry: {
                places: [{ place_id: 'pl-2', name: 'Hallway', spot: 'bucket' }],
                stock_level: null,
                stock_amount: null,
                allergies: [],
              },
            },
          ],
        }),
      ]),
    )

    expect(await screen.findByRole('link', { name: 'Ingredients (1)' })).toBeTruthy()
  })

  it('asks a chore for cleaners and nothing else', async () => {
    renderPage(stub({}, [aMeal({ label: 'Morning cleanup', at: '09:00', kind: 'chore' })]))

    await screen.findByText('Morning cleanup')

    expect(
      screen.queryByRole('button', { name: 'Take the spot on Morning cleanup on 2026-08-01' }),
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Take the spot on cooking at Morning cleanup on 2026-08-01' }),
    ).toBeNull()
    expect(screen.queryByLabelText('Food idea for Morning cleanup on 2026-08-01')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Ingredients' })).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Take the spot on cleanup at Morning cleanup on 2026-08-01' }),
    ).toBeTruthy()
  })

  it('asks an ordinary meal for all three', async () => {
    renderPage(stub())

    expect(await screen.findByRole('button', { name: 'Take the spot on Dinner on 2026-08-01' })).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Take the spot on cooking at Dinner on 2026-08-01' }),
    ).toBeTruthy()
    expect(screen.getByLabelText('Food idea for Dinner on 2026-08-01')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Take the spot on cleanup at Dinner on 2026-08-01' }),
    ).toBeTruthy()
  })

  it('says which kind of nothing it has, when it has none', async () => {
    renderPage(stub({ getMeals: () => Promise.resolve({ intro_markdown: '', slots: [], meals: [] }) }, []))

    expect(await screen.findByText(/Nobody has set up meal times/)).toBeTruthy()
  })

  it('says so when the times are set but the days are not', async () => {
    renderPage(stub({}, []))

    expect(await screen.findByText(/the days have not been filled in/)).toBeTruthy()
  })

  it('rewrites the words above the table', async () => {
    const updateMealIntro = vi.fn<MealsApi['updateMealIntro']>(() =>
      Promise.resolve({ meal_intro_markdown: 'Breakfast is DIY.' }),
    )
    renderPage(stub({ updateMealIntro }))

    fireEvent.click(await screen.findByRole('button', { name: 'Edit these words' }))
    fireEvent.input(screen.getByLabelText('What everyone should know'), {
      target: { value: 'Breakfast is DIY.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updateMealIntro).toHaveBeenCalledWith('e-1', { meal_intro_markdown: 'Breakfast is DIY.' }),
    )
  })
})

describe('a chore that still has somebody on it', () => {
  const chore = (over: Partial<Meal> = {}) =>
    aMeal({ label: 'Morning cleanup', at: '09:00', kind: 'chore', ...over })

  it('shows a stranded lead, and lets them be vacated', async () => {
    const setMealLead = vi.fn<MealsApi['setMealLead']>(() => Promise.resolve({ meal: chore() }))
    renderPage(stub({ setMealLead }, [chore({ lead: { account_id: 'a-1', name: 'Ada' } })]))

    fireEvent.click(await screen.findByRole('button', { name: 'Take Ada off Morning cleanup on 2026-08-01' }))

    await waitFor(() => expect(setMealLead).toHaveBeenCalledWith('m-1', { account_id: null }))
  })

  it('names whoever is on it, and offers nobody else, since the API would refuse', async () => {
    renderPage(stub({}, [chore({ lead: { account_id: 'a-1', name: 'Ada' } })]))

    expect(await screen.findByText('Ada')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Take Ada off Morning cleanup on 2026-08-01' })).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: 'Appoint someone to Morning cleanup on 2026-08-01' }),
    ).toBeNull()
  })

  it('shows the one on it even after they have withdrawn from the burn', async () => {
    renderPage(stub({}, [chore({ lead: { account_id: 'a-9', name: 'Gone' } })]))

    expect(await screen.findByText('Gone')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Take Gone off Morning cleanup on 2026-08-01' })).toBeTruthy()
  })

  it('lets a stranded cook stand down, and offers nobody the chance to join', async () => {
    const leaveMealCrew = vi.fn<MealsApi['leaveMealCrew']>(() => Promise.resolve({ meal: chore() }))
    renderPage(stub({ leaveMealCrew }, [chore({ helpers: [{ account_id: 'a-1', name: 'Ada' }] })]))

    fireEvent.click(
      await screen.findByRole('button', { name: 'Take Ada off cooking at Morning cleanup on 2026-08-01' }),
    )

    await waitFor(() => expect(leaveMealCrew).toHaveBeenCalledWith('m-1', 'helper', 'a-1'))
  })

  it('offers nobody else the chance to start cooking at one', async () => {
    renderPage(stub({}, [chore({ helpers: [{ account_id: 'a-9', name: 'Someone else' }] })]))

    await screen.findByText('Someone else')

    expect(screen.queryByLabelText('Help cook at Morning cleanup on 2026-08-01')).toBeNull()
  })

  it('offers nothing at all on a chore nobody is on', async () => {
    renderPage(stub({}, [chore()]))

    await screen.findByText('Morning cleanup')

    expect(
      screen.queryByRole('button', { name: 'Take the spot on Morning cleanup on 2026-08-01' }),
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Take the spot on cooking at Morning cleanup on 2026-08-01' }),
    ).toBeNull()
  })
})

describe('what people want there', () => {
  it('asks for breakfast, snacks and the house, and leaves the cupboard staples to the pantry', async () => {
    renderPage(stub())

    expect(await screen.findByRole('heading', { name: 'What do you want for breakfast?' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Snacks' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Around the house' })).toBeTruthy()
    expect(screen.getByText('Dates')).toBeTruthy()
    expect(screen.queryByText('Rice')).toBeNull()
  })

  it('puts what most people want at the top of its section', async () => {
    renderPage(stub())

    await screen.findByText('Oatmeal')

    const wanted = [...document.querySelectorAll('.wanted-list')][0]

    expect([...(wanted?.querySelectorAll('li > span') ?? [])].map((row) => row.textContent)).toEqual([
      'Berries, frozen',
      'Oatmeal',
    ])
  })

  it('hearts a thing', async () => {
    const heartPantryItem = vi.fn<MealsApi['heartPantryItem']>(() => Promise.resolve(undefined))
    renderPage(stub({ heartPantryItem }))

    fireEvent.click(await screen.findByRole('button', { name: 'Give a heart to Berries, frozen' }))

    await waitFor(() => expect(heartPantryItem).toHaveBeenCalledWith('e-1', 'p-2'))
  })

  it('takes back a heart of your own', async () => {
    const unheartPantryItem = vi.fn<MealsApi['unheartPantryItem']>(() => Promise.resolve(undefined))
    renderPage(stub({ unheartPantryItem }))

    fireEvent.click(await screen.findByRole('button', { name: 'Take back your heart for Oatmeal' }))

    await waitFor(() => expect(unheartPantryItem).toHaveBeenCalledWith('e-1', 'p-1'))
  })

  it('offers the heart to somebody who has not joined, and says to join when they press it', async () => {
    renderPage(stub({ heartPantryItem: () => Promise.reject(apiError(400, 'not_attending', 'Bad request')) }))

    fireEvent.click(await screen.findByRole('button', { name: 'Give a heart to Berries, frozen' }))

    expect(await screen.findByText(/You need to join this burn/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Your details' })).toBeTruthy()
  })

  it('leads to the shopping list for this burn', async () => {
    renderPage(stub())

    const link = await screen.findByRole('link', { name: 'Shopping list' })

    expect(link.getAttribute('href')).toBe('/shopping?burn=e-1')
  })

  it('says where to ask for something the pantry has not got', async () => {
    renderPage(stub())

    await screen.findByText('Oatmeal')

    expect(screen.getByRole('link', { name: 'bring list' }).getAttribute('href')).toBe('/bring?burn=e-1')
    expect(screen.getByRole('link', { name: 'pantry' }).getAttribute('href')).toBe('/pantry')
  })
})
