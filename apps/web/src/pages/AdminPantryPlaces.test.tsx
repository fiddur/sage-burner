import type { PantryItem, PantryPlace } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { PantryPlacesApi } from './AdminPantryPlaces.tsx'

import { apiError } from '../api/client.ts'
import { ViewerProvider } from '../viewer.tsx'
import { AdminPantryPlaces } from './AdminPantryPlaces.tsx'

afterEach(cleanup)

const ADMIN: Viewer = {
  status: 'signed-in',
  account: { id: 'a-1', name: 'Ada', avatar: null, roles: ['admin'] },
}

const PLACES: PantryPlace[] = [
  { id: 'pl-1', order: 0, name: 'Kitchen' },
  { id: 'pl-2', order: 1, name: 'Cellar' },
]

const ITEMS: PantryItem[] = [
  {
    id: 'p-1',
    kind: 'staple',
    name: 'Rice',
    unit: 'kg',
    note: '',
    stock_level: null,
    stock_amount: null,
    counted_by: null,
    counted_by_name: null,
    counted_at: null,
    need_more: null,
    places: [{ place_id: 'pl-2', name: 'Cellar', spot: 'R2' }],
    withdrawn_at: null,
    created_at: '2026-09-01T00:00:00.000Z',
    allergies: [],
  },
]

const stub = (over: Partial<PantryPlacesApi> = {}): PantryPlacesApi => ({
  getPantryPlaces: () => Promise.resolve({ places: PLACES }),
  getPantry: () => Promise.resolve({ items: ITEMS }),
  addPantryPlace: () => Promise.reject(new Error('addPantryPlace is not stubbed here')),
  updatePantryPlace: () => Promise.reject(new Error('updatePantryPlace is not stubbed here')),
  deletePantryPlace: () => Promise.reject(new Error('deletePantryPlace is not stubbed here')),
  reorderPantryPlaces: () => Promise.reject(new Error('reorderPantryPlaces is not stubbed here')),
  ...over,
})

const renderPage = (api: PantryPlacesApi) =>
  render(
    <ViewerProvider viewer={ADMIN}>
      <AdminPantryPlaces api={api} />
    </ViewerProvider>,
  )

describe('the pantry places an admin keeps', () => {
  it('lists the rooms in the order somebody walks them', async () => {
    renderPage(stub())

    expect(await screen.findByText('Kitchen')).toBeTruthy()
    expect(screen.getByText('Cellar')).toBeTruthy()
  })

  it('says how much is in each, which is what the refused removal is about', async () => {
    renderPage(stub())

    expect(await screen.findByText('1 thing')).toBeTruthy()
    expect(screen.getByText('0 things')).toBeTruthy()
  })

  it('adds a room', async () => {
    const addPantryPlace = vi.fn(() => Promise.resolve({ place: { id: 'pl-3', order: 2, name: 'Shed' } }))
    renderPage(stub({ addPantryPlace }))

    await screen.findByText('Kitchen')
    fireEvent.input(screen.getByLabelText('Add a room'), { target: { value: '  Shed  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(addPantryPlace).toHaveBeenCalledWith({ name: 'Shed' }))
  })

  it('says a name is taken rather than “could not save that”', async () => {
    renderPage(stub({ addPantryPlace: () => Promise.reject(apiError(409, 'conflict', 'nope')) }))

    await screen.findByText('Kitchen')
    fireEvent.input(screen.getByLabelText('Add a room'), { target: { value: 'Cellar' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect((await screen.findByRole('alert')).textContent).toContain('already a room called')
  })

  it('renames one, which is what a room full of things gets instead of removal', async () => {
    const updatePantryPlace = vi.fn(() => Promise.resolve({ place: { ...PLACES[1]!, name: 'Källaren' } }))
    renderPage(stub({ updatePantryPlace }))

    fireEvent.click(await screen.findByLabelText('Edit Cellar'))
    fireEvent.input(screen.getByLabelText('Rename Cellar'), { target: { value: 'Källaren' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updatePantryPlace).toHaveBeenCalledWith('pl-2', { name: 'Källaren' }))
  })

  it('removes an empty room', async () => {
    const deletePantryPlace = vi.fn(() => Promise.resolve(undefined))
    renderPage(stub({ deletePantryPlace }))

    fireEvent.click(await screen.findByLabelText('Remove Kitchen'))
    fireEvent.click(screen.getByRole('button', { name: 'Really remove Kitchen' }))

    await waitFor(() => expect(deletePantryPlace).toHaveBeenCalledWith('pl-1'))
  })

  it('says how many things hold a room that cannot be removed, and what to do instead', async () => {
    renderPage(stub({ deletePantryPlace: () => Promise.reject(apiError(409, 'conflict', 'nope')) }))

    fireEvent.click(await screen.findByLabelText('Remove Cellar'))
    fireEvent.click(screen.getByRole('button', { name: 'Really remove Cellar' }))

    const said = (await screen.findByRole('alert')).textContent
    expect(said).toContain('Rename it instead')
    expect(said).toContain('1 thing is in it')
  })

  it('reports an ordinary removal failure plainly', async () => {
    renderPage(stub({ deletePantryPlace: () => Promise.reject(apiError(500, 'unknown', 'boom')) }))

    fireEvent.click(await screen.findByLabelText('Remove Kitchen'))
    fireEvent.click(screen.getByRole('button', { name: 'Really remove Kitchen' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Could not remove that')
  })

  it('reorders by sending the whole list', async () => {
    const reorderPantryPlaces = vi.fn(() => Promise.resolve({ places: PLACES }))
    renderPage(stub({ reorderPantryPlaces }))

    fireEvent.click(await screen.findByLabelText('Move Cellar up'))

    await waitFor(() => expect(reorderPantryPlaces).toHaveBeenCalledWith(['pl-2', 'pl-1']))
  })
})
