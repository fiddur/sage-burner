import type { AllergyItem } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { AllergiesApi } from './AdminAllergies.tsx'

import { apiError } from '../api/client.ts'
import { ViewerProvider } from '../viewer.tsx'
import { AdminAllergies } from './AdminAllergies.tsx'

afterEach(cleanup)

const ADMIN: Viewer = {
  status: 'signed-in',
  account: { id: 'a-1', name: 'Ada', avatar: null, roles: ['admin'] },
}

const ITEMS: AllergyItem[] = [
  { id: 'i-1', order: 0, label: 'Vegan' },
  { id: 'i-2', order: 1, label: 'Lactose' },
]

const stub = (over: Partial<AllergiesApi> = {}, items: AllergyItem[] = ITEMS): AllergiesApi => ({
  getAllergyItems: () => Promise.resolve({ items }),
  addAllergyItem: () => Promise.reject(new Error('addAllergyItem is not stubbed here')),
  updateAllergyItem: () => Promise.reject(new Error('updateAllergyItem is not stubbed here')),
  deleteAllergyItem: () => Promise.reject(new Error('deleteAllergyItem is not stubbed here')),
  reorderAllergyItems: () => Promise.reject(new Error('reorderAllergyItems is not stubbed here')),
  ...over,
})

const renderPage = (api: AllergiesApi) =>
  render(
    <ViewerProvider viewer={ADMIN}>
      <AdminAllergies api={api} />
    </ViewerProvider>,
  )

describe('AdminAllergies', () => {
  it('lists what members can tick', async () => {
    renderPage(stub())

    expect(await screen.findByText('Vegan')).toBeTruthy()
    expect(screen.getByText('Lactose')).toBeTruthy()
  })

  it('adds one, which is the whole point of rows over an enum', async () => {
    const addAllergyItem = vi.fn(() => Promise.resolve({ item: { id: 'i-3', order: 2, label: 'Nuts' } }))
    renderPage(stub({ addAllergyItem }))

    await screen.findByText('Vegan')
    fireEvent.input(screen.getByLabelText('Add an item'), { target: { value: '  Nuts  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(addAllergyItem).toHaveBeenCalledWith({ label: 'Nuts' }))
  })

  it('renames one', async () => {
    const updateAllergyItem = vi.fn(() =>
      Promise.resolve({ item: { ...ITEMS[1]!, label: 'Lactose (mild)' } }),
    )
    renderPage(stub({ updateAllergyItem }))

    fireEvent.click(await screen.findByLabelText('Edit Lactose'))
    fireEvent.input(screen.getByLabelText('Rename Lactose'), { target: { value: 'Lactose (mild)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateAllergyItem).toHaveBeenCalledWith('i-2', { label: 'Lactose (mild)' }))
  })

  it('says who is holding an item that cannot be removed, and what to do instead', async () => {
    // The refusal is the feature: a label going must not take part of somebody's
    // record with it. A generic "could not remove that" would send an admin
    // retrying forever.
    renderPage(stub({ deleteAllergyItem: () => Promise.reject(apiError(409, 'conflict', 'nope')) }))

    fireEvent.click(await screen.findByLabelText('Remove Vegan'))
    fireEvent.click(screen.getByRole('button', { name: 'Really remove Vegan' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Rename it instead')
  })

  it('reports an ordinary removal failure plainly', async () => {
    // The passing sibling: showing the ticked-by-somebody message for every failure
    // would satisfy the test above while misdescribing a network drop.
    renderPage(stub({ deleteAllergyItem: () => Promise.reject(apiError(500, 'unknown', 'boom')) }))

    fireEvent.click(await screen.findByLabelText('Remove Vegan'))
    fireEvent.click(screen.getByRole('button', { name: 'Really remove Vegan' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Could not remove that')
  })

  it('reorders by sending the whole list', async () => {
    const reorderAllergyItems = vi.fn(() => Promise.resolve({ items: ITEMS }))
    renderPage(stub({ reorderAllergyItems }))

    fireEvent.click(await screen.findByLabelText('Move Lactose up'))

    await waitFor(() => expect(reorderAllergyItems).toHaveBeenCalledWith(['i-2', 'i-1']))
  })

  it('offers no move past either end', async () => {
    renderPage(stub())

    expect((await screen.findByLabelText('Move Vegan up')).hasAttribute('disabled')).toBe(true)
    expect(screen.getByLabelText('Move Lactose down').hasAttribute('disabled')).toBe(true)
  })
})
