import type { Event, EventOption } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { OptionsApi } from './AdminOptions.tsx'

import { apiError } from '../api/client.ts'
import { ViewerProvider } from '../viewer.tsx'
import { AdminOptions } from './AdminOptions.tsx'

afterEach(cleanup)

const ADMIN: Viewer = { status: 'signed-in', account: { id: 'a-1', roles: ['admin'] } }

const BURN: Event = {
  id: 'e-1',
  name: 'Summer burn',
  slug: 'summer-2026',
  start_date: '2026-08-01',
  end_date: '2026-08-05',
  start_time: '00:00',
  end_time: '23:59',
  welcome_markdown: '',
  member_cap: 42,
  created_at: '2026-07-02T00:00:00.000Z',
}

const anOption = (over: Partial<EventOption> & Pick<EventOption, 'id' | 'label' | 'kind'>): EventOption => ({
  event_id: 'e-1',
  order: 0,
  capacity: null,
  ...over,
})

const TEMPLE = anOption({ id: 'o-1', label: 'Temple mattress', kind: 'lodging', capacity: 9, order: 0 })
const TENT = anOption({ id: 'o-2', label: 'Own tent', kind: 'lodging', order: 1 })
const SAUNA = anOption({ id: 'o-3', label: 'Sauna tending', kind: 'helping', order: 0 })

const stub = (
  over: Partial<OptionsApi> = {},
  options: EventOption[] = [TEMPLE, TENT, SAUNA],
  event: Event | null = BURN,
): OptionsApi => ({
  getActiveEvent: () => Promise.resolve({ event }),
  getEventOptions: () => Promise.resolve({ options }),
  addEventOption: () => Promise.reject(new Error('addEventOption is not stubbed here')),
  updateEventOption: () => Promise.reject(new Error('updateEventOption is not stubbed here')),
  deleteEventOption: () => Promise.reject(new Error('deleteEventOption is not stubbed here')),
  reorderEventOptions: () => Promise.reject(new Error('reorderEventOptions is not stubbed here')),
  ...over,
})

const renderPage = (api: OptionsApi, viewer: Viewer = ADMIN) =>
  render(
    <ViewerProvider viewer={viewer}>
      <AdminOptions api={api} />
    </ViewerProvider>,
  )

describe('AdminOptions', () => {
  it('shows both lists, with the spaces on the ones that have them', async () => {
    renderPage(stub())

    expect(await screen.findByText('Temple mattress')).toBeTruthy()
    expect(screen.getByText('9 spaces')).toBeTruthy()
    expect(screen.getByText('Own tent')).toBeTruthy()
    expect(screen.getAllByText('no limit')).toHaveLength(2)
    expect(screen.getByText('Sauna tending')).toBeTruthy()
  })

  it('offers spaces only for lodging, since nothing runs short of helpers', async () => {
    renderPage(stub())

    expect(await screen.findByLabelText('New lodging spaces')).toBeTruthy()
    expect(screen.queryByLabelText('New helping spaces')).toBeNull()
  })

  it('adds somewhere to sleep with a number of spaces', async () => {
    const addEventOption = vi.fn<OptionsApi['addEventOption']>(() => Promise.resolve({ option: TEMPLE }))
    renderPage(stub({ addEventOption }))

    fireEvent.input(await screen.findByLabelText('New lodging name'), { target: { value: '  Barn  ' } })
    fireEvent.input(screen.getByLabelText('New lodging spaces'), { target: { value: '4' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]!)

    await waitFor(() =>
      expect(addEventOption).toHaveBeenCalledWith('e-1', {
        kind: 'lodging',
        label: 'Barn',
        capacity: 4,
      }),
    )
  })

  it('adds one with no limit when the spaces box is left blank', async () => {
    const addEventOption = vi.fn<OptionsApi['addEventOption']>(() => Promise.resolve({ option: TENT }))
    renderPage(stub({ addEventOption }))

    fireEvent.input(await screen.findByLabelText('New lodging name'), { target: { value: 'Own tent' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]!)

    await waitFor(() =>
      expect(addEventOption).toHaveBeenCalledWith('e-1', {
        kind: 'lodging',
        label: 'Own tent',
        capacity: null,
      }),
    )
  })

  it('adds to the helping list without a capacity at all', async () => {
    const addEventOption = vi.fn<OptionsApi['addEventOption']>(() => Promise.resolve({ option: SAUNA }))
    renderPage(stub({ addEventOption }))

    fireEvent.input(await screen.findByLabelText('New helping name'), { target: { value: 'Kitchen' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[1]!)

    await waitFor(() =>
      expect(addEventOption).toHaveBeenCalledWith('e-1', {
        kind: 'helping',
        label: 'Kitchen',
        capacity: null,
      }),
    )
  })

  it('refuses a nameless entry', async () => {
    const addEventOption = vi.fn<OptionsApi['addEventOption']>(() => Promise.resolve({ option: TEMPLE }))
    renderPage(stub({ addEventOption }))

    fireEvent.click((await screen.findAllByRole('button', { name: 'Add' }))[0]!)

    expect((await screen.findByRole('alert')).textContent).toContain('Give it a name')
    expect(addEventOption).not.toHaveBeenCalled()
  })

  it('leaves a bad number to the browser, which will not submit the form', async () => {
    // `min="1"` and the implicit whole-number step make the form unsubmittable,
    // so nothing here reaches the handler — which is why there is no JavaScript
    // guard for it. Asserted rather than assumed: a JS guard *would* have been
    // dead code, and this is what proves it.
    const addEventOption = vi.fn<OptionsApi['addEventOption']>(() => Promise.resolve({ option: TEMPLE }))
    renderPage(stub({ addEventOption }))

    fireEvent.input(await screen.findByLabelText('New lodging name'), { target: { value: 'Barn' } })
    fireEvent.input(screen.getByLabelText('New lodging spaces'), { target: { value: '1.5' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]!)

    await waitFor(() => expect(addEventOption).not.toHaveBeenCalled())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('edits the name and the spaces', async () => {
    const updateEventOption = vi.fn<OptionsApi['updateEventOption']>(() =>
      Promise.resolve({ option: TEMPLE }),
    )
    renderPage(stub({ updateEventOption }))

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Temple mattress' }))
    fireEvent.input(screen.getByLabelText('Spaces in Temple mattress'), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updateEventOption).toHaveBeenCalledWith('o-1', {
        label: 'Temple mattress',
        capacity: 12,
      }),
    )
  })

  it('clears a capacity back to no limit', async () => {
    const updateEventOption = vi.fn<OptionsApi['updateEventOption']>(() =>
      Promise.resolve({ option: TEMPLE }),
    )
    renderPage(stub({ updateEventOption }))

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Temple mattress' }))
    fireEvent.input(screen.getByLabelText('Spaces in Temple mattress'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updateEventOption).toHaveBeenCalledWith('o-1', {
        label: 'Temple mattress',
        capacity: null,
      }),
    )
  })

  it('sends no capacity at all when editing a helping entry', async () => {
    // The column exists for every row, but a helping entry has no spaces box —
    // sending `capacity: null` from a form that never offered it would be the UI
    // deciding something it was not asked about.
    const updateEventOption = vi.fn<OptionsApi['updateEventOption']>(() => Promise.resolve({ option: SAUNA }))
    renderPage(stub({ updateEventOption }))

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Sauna tending' }))
    fireEvent.input(screen.getByLabelText('Name of Sauna tending'), { target: { value: 'Sauna' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateEventOption).toHaveBeenCalledWith('o-3', { label: 'Sauna' }))
  })

  it('removes one', async () => {
    const deleteEventOption = vi.fn<OptionsApi['deleteEventOption']>(() => Promise.resolve(undefined))
    renderPage(stub({ deleteEventOption }))

    fireEvent.click(await screen.findByRole('button', { name: 'Remove Own tent' }))

    await waitFor(() => expect(deleteEventOption).toHaveBeenCalledWith('o-2'))
  })

  it('reorders one list from the keyboard, naming only that list', async () => {
    const reorderEventOptions = vi.fn<OptionsApi['reorderEventOptions']>(() =>
      Promise.resolve({ options: [] }),
    )
    renderPage(stub({ reorderEventOptions }))

    fireEvent.keyDown(await screen.findByRole('button', { name: 'Move Own tent' }), { key: 'ArrowUp' })

    await waitFor(() => expect(reorderEventOptions).toHaveBeenCalledWith('e-1', 'lodging', ['o-2', 'o-1']))
  })

  it('reorders by dragging, and writes to the drag store for Firefox', async () => {
    const reorderEventOptions = vi.fn<OptionsApi['reorderEventOptions']>(() =>
      Promise.resolve({ options: [] }),
    )
    const setData = vi.fn()
    renderPage(stub({ reorderEventOptions }))

    fireEvent.dragStart(await screen.findByRole('button', { name: 'Move Own tent' }), {
      dataTransfer: { setData },
    })
    fireEvent.drop(document.querySelectorAll('.place-row')[0]!)

    expect(setData).toHaveBeenCalledWith('text/plain', 'o-2')
    await waitFor(() => expect(reorderEventOptions).toHaveBeenCalledWith('e-1', 'lodging', ['o-2', 'o-1']))
  })

  it('says so when no burn is open, since the lists belong to one', async () => {
    renderPage(stub({}, [], null))

    expect(await screen.findByText(/no burn open/)).toBeTruthy()
    expect(screen.queryByLabelText('New lodging name')).toBeNull()
  })

  it('surfaces a failure to load', async () => {
    renderPage(stub({ getEventOptions: () => Promise.reject(new Error('nope')) }))

    expect((await screen.findByRole('alert')).textContent).toContain('Could not load')
  })

  it('shows what the server said when a write is refused', async () => {
    renderPage(stub({ deleteEventOption: () => Promise.reject(apiError(409, 'conflict', 'In use.')) }))

    fireEvent.click(await screen.findByRole('button', { name: 'Remove Own tent' }))

    expect((await screen.findByRole('alert')).textContent).toContain('In use.')
  })

  it('offers nothing to someone who is not an organiser, and asks the API nothing', async () => {
    // Asserted after a flush, not synchronously: the fetch is two awaits deep, so
    // an immediate assertion passes whether or not the guard is there.
    const getActiveEvent = vi.fn<OptionsApi['getActiveEvent']>(() => Promise.resolve({ event: BURN }))
    const getEventOptions = vi.fn<OptionsApi['getEventOptions']>(() => Promise.resolve({ options: [] }))
    renderPage(stub({ getActiveEvent, getEventOptions }), { status: 'signed-out' })

    expect(screen.getByText(/for organisers/)).toBeTruthy()
    await waitFor(() => expect(getActiveEvent).not.toHaveBeenCalled())
    expect(getEventOptions).not.toHaveBeenCalled()
  })
})
