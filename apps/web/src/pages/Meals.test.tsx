import type { Meal, MyBurn } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { MealsApi } from './Meals.tsx'

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
  lead: null,
  helpers: [],
  cleanup: [],
  ...over,
})

const stub = (over: Partial<MealsApi> = {}, meals: Meal[] = [aMeal()]): MealsApi => ({
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
        // A second, so a control offering everybody can be told from one offering only
        // whoever is already on the sitting.
        { account_id: 'a-2', name: 'Bea', avatar: null },
      ],
    }),
  setMealLead: () => Promise.reject(new Error('setMealLead is not stubbed here')),
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

  it('takes the lead for somebody', async () => {
    const setMealLead = vi.fn<MealsApi['setMealLead']>(() => Promise.resolve({ meal: aMeal() }))
    renderPage(stub({ setMealLead }))

    fireEvent.change(await screen.findByLabelText('Lead for Dinner on 2026-08-01'), {
      target: { value: 'a-1' },
    })

    await waitFor(() => expect(setMealLead).toHaveBeenCalledWith('m-1', { account_id: 'a-1' }))
  })

  it('stands for the cleanup crew', async () => {
    const joinMealCrew = vi.fn<MealsApi['joinMealCrew']>(() => Promise.resolve({ meal: aMeal() }))
    renderPage(stub({ joinMealCrew }))

    fireEvent.click(await screen.findByLabelText('Help clean up at Dinner on 2026-08-01'))

    await waitFor(() => expect(joinMealCrew).toHaveBeenCalledWith('m-1', 'cleanup'))
  })

  it('writes a food idea when the field is left, not on every keystroke', async () => {
    // A note several people pass through, so a request per character would be a
    // request per character.
    const setMealIdea = vi.fn<MealsApi['setMealIdea']>(() => Promise.resolve({ meal: aMeal() }))
    renderPage(stub({ setMealIdea }))

    const field = await screen.findByLabelText('Food idea for Dinner on 2026-08-01')
    fireEvent.input(field, { target: { value: 'Vegan bolognese' } })
    expect(setMealIdea).not.toHaveBeenCalled()

    fireEvent.blur(field)

    await waitFor(() => expect(setMealIdea).toHaveBeenCalledWith('m-1', { food_idea: 'Vegan bolognese' }))
  })

  it('asks a chore for cleaners and nothing else', async () => {
    renderPage(stub({}, [aMeal({ label: 'Morning cleanup', at: '09:00', kind: 'chore' })]))

    await screen.findByText('Morning cleanup')

    expect(screen.queryByLabelText('Lead for Morning cleanup on 2026-08-01')).toBeNull()
    expect(screen.queryByLabelText('Help cook at Morning cleanup on 2026-08-01')).toBeNull()
    expect(screen.getByLabelText('Help clean up at Morning cleanup on 2026-08-01')).toBeTruthy()
  })

  it('asks an ordinary meal for all three', async () => {
    // The passing sibling: hiding them for every sitting would satisfy the test above.
    renderPage(stub())

    expect(await screen.findByLabelText('Lead for Dinner on 2026-08-01')).toBeTruthy()
    expect(screen.getByLabelText('Help cook at Dinner on 2026-08-01')).toBeTruthy()
    expect(screen.getByLabelText('Help clean up at Dinner on 2026-08-01')).toBeTruthy()
  })

  it('says which kind of nothing it has, when it has none', async () => {
    // "Nobody set this up" and "set up, not filled in" want different answers.
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
  /**
   * The slot changed under them. The API keeps both escape hatches open — a lead may
   * vacate, a cook may stand down — so the page has to offer them, or the promise in
   * the route's own comment is one nothing can act on.
   */
  const chore = (over: Partial<Meal> = {}) =>
    aMeal({ label: 'Morning cleanup', at: '09:00', kind: 'chore', ...over })

  it('shows a stranded lead, and lets them be vacated', async () => {
    const setMealLead = vi.fn<MealsApi['setMealLead']>(() => Promise.resolve({ meal: chore() }))
    renderPage(stub({ setMealLead }, [chore({ lead: { account_id: 'a-1', name: 'Ada' } })]))

    const select = await screen.findByLabelText('Lead for Morning cleanup on 2026-08-01')
    fireEvent.change(select, { target: { value: '' } })

    await waitFor(() => expect(setMealLead).toHaveBeenCalledWith('m-1', { account_id: null }))
  })

  it('names whoever is on it, and offers nobody else, since the API would refuse', async () => {
    // Two options and no more: "Nobody yet", which vacates, and the person already on
    // it. Without the second nothing matches the control's value and it draws blank —
    // vacant-looking while somebody is still on it, which is the thing the whole
    // stale-lead option exists to prevent.
    renderPage(stub({}, [chore({ lead: { account_id: 'a-1', name: 'Ada' } })]))

    const select = await screen.findByLabelText('Lead for Morning cleanup on 2026-08-01')
    const options = [...select.querySelectorAll('option')].map((option) => option.textContent)

    expect(options).toEqual(['Nobody yet', 'Ada'])
    expect(select).toHaveProperty('value', 'a-1')
  })

  it('says so when the one on it has withdrawn as well', async () => {
    renderPage(stub({}, [chore({ lead: { account_id: 'a-9', name: 'Gone' } })]))

    const select = await screen.findByLabelText('Lead for Morning cleanup on 2026-08-01')

    expect(select.textContent).toContain('Gone — no longer coming')
  })

  it('lets a stranded cook stand down, and offers nobody the chance to join', async () => {
    const leaveMealCrew = vi.fn<MealsApi['leaveMealCrew']>(() => Promise.resolve({ meal: chore() }))
    renderPage(stub({ leaveMealCrew }, [chore({ helpers: [{ account_id: 'a-1', name: 'Ada' }] })]))

    fireEvent.click(await screen.findByLabelText('Do not cook at Morning cleanup on 2026-08-01'))

    await waitFor(() => expect(leaveMealCrew).toHaveBeenCalledWith('m-1', 'helper'))
  })

  it('offers nobody else the chance to start cooking at one', async () => {
    // The viewer is not on this crew. Without the distinction, a chore that had one
    // stranded cook would invite everybody else to join it — which the API answers
    // with 400.
    renderPage(stub({}, [chore({ helpers: [{ account_id: 'a-9', name: 'Someone else' }] })]))

    await screen.findByText('Someone else')

    expect(screen.queryByLabelText('Help cook at Morning cleanup on 2026-08-01')).toBeNull()
  })

  it('offers nothing at all on a chore nobody is on', async () => {
    // The passing sibling: showing the controls whenever the kind is a chore would
    // satisfy the three above while putting back the thing they exist to prevent.
    renderPage(stub({}, [chore()]))

    await screen.findByText('Morning cleanup')

    expect(screen.queryByLabelText('Lead for Morning cleanup on 2026-08-01')).toBeNull()
    expect(screen.queryByLabelText('Help cook at Morning cleanup on 2026-08-01')).toBeNull()
  })
})
