import type { Place } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { PlacesApi } from './AdminPlaces.tsx'

import { apiError } from '../api/client.ts'
import { ViewerProvider } from '../viewer.tsx'
import { AdminPlaces } from './AdminPlaces.tsx'

afterEach(cleanup)

const ADMIN: Viewer = { status: 'signed-in', account: { id: 'a-1', roles: ['admin'] } }

const aPlace = (over: Partial<Place> & Pick<Place, 'id' | 'name'>): Place => ({
  order: 0,
  emoji: '🛕',
  color: 'yellow',
  ...over,
})

const THREE: Place[] = [
  aPlace({ id: 'p-1', name: 'Temple', order: 0, emoji: '🛕', color: 'yellow' }),
  aPlace({ id: 'p-2', name: 'Sauna', order: 1, emoji: '🥵', color: 'red' }),
  aPlace({ id: 'p-3', name: 'Front Lawn', order: 2, emoji: '🌳', color: 'green' }),
]

const stub = (over: Partial<PlacesApi> = {}, places: Place[] = THREE): PlacesApi => ({
  getPlaces: () => Promise.resolve({ places }),
  addPlace: () => Promise.reject(new Error('addPlace is not stubbed here')),
  updatePlace: () => Promise.reject(new Error('updatePlace is not stubbed here')),
  deletePlace: () => Promise.reject(new Error('deletePlace is not stubbed here')),
  reorderPlaces: () => Promise.reject(new Error('reorderPlaces is not stubbed here')),
  ...over,
})

const renderPage = (api: PlacesApi, viewer: Viewer = ADMIN) =>
  render(
    <ViewerProvider viewer={viewer}>
      <AdminPlaces api={api} />
    </ViewerProvider>,
  )

const rowNames = () => [...document.querySelectorAll('.place-name')].map((node) => node.textContent)

describe('AdminPlaces', () => {
  it('lists the places in order, with their emoji and colour', async () => {
    renderPage(stub())

    expect(await screen.findByText('Temple')).toBeTruthy()
    expect(rowNames()).toEqual(['Temple', 'Sauna', 'Front Lawn'])
    expect(document.querySelector('.place-swatch')?.className).toContain('place-yellow')
  })

  it('says so when there are none, rather than showing an empty list', async () => {
    renderPage(stub({}, []))

    expect(await screen.findByText(/No places yet/)).toBeTruthy()
  })

  it('adds one, trimmed, so a stray space is not part of the name', async () => {
    const addPlace = vi.fn<PlacesApi['addPlace']>(() =>
      Promise.resolve({ place: aPlace({ id: 'p-4', name: 'Sexy Field' }) }),
    )
    renderPage(stub({ addPlace }, []))

    fireEvent.input(await screen.findByRole('textbox', { name: 'Name' }), {
      target: { value: '  Sexy Field  ' },
    })
    fireEvent.input(screen.getByRole('textbox', { name: 'Emoji' }), { target: { value: ' 🌸 ' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Colour' }), { target: { value: 'purple' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() =>
      expect(addPlace).toHaveBeenCalledWith({ name: 'Sexy Field', emoji: '🌸', color: 'purple' }),
    )
  })

  it('refuses to add one without a name or an emoji, rather than letting the server say no', async () => {
    // `aria-required`, not `required`, so the browser does not block the submit
    // before this message can be shown.
    const addPlace = vi.fn<PlacesApi['addPlace']>(() =>
      Promise.resolve({ place: aPlace({ id: 'p-4', name: 'x' }) }),
    )
    renderPage(stub({ addPlace }, []))

    fireEvent.input(await screen.findByRole('textbox', { name: 'Name' }), { target: { value: 'Temple' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect((await screen.findByRole('alert')).textContent).toContain('needs a name and an emoji')
    expect(addPlace).not.toHaveBeenCalled()
  })

  it('edits one behind the pencil', async () => {
    const updatePlace = vi.fn<PlacesApi['updatePlace']>(() =>
      Promise.resolve({ place: aPlace({ id: 'p-2', name: 'Steam Room' }) }),
    )
    renderPage(stub({ updatePlace }))

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Sauna' }))
    fireEvent.input(screen.getByRole('textbox', { name: 'Name of Sauna' }), {
      target: { value: 'Steam Room' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updatePlace).toHaveBeenCalledWith('p-2', {
        name: 'Steam Room',
        emoji: '🥵',
        color: 'red',
      }),
    )
  })

  it('removes one behind the trashcan', async () => {
    const deletePlace = vi.fn<PlacesApi['deletePlace']>(() => Promise.resolve(undefined))
    renderPage(stub({ deletePlace }))

    fireEvent.click(await screen.findByRole('button', { name: 'Remove Sauna' }))

    await waitFor(() => expect(deletePlace).toHaveBeenCalledWith('p-2'))
  })

  it('reorders by dragging a row onto another', async () => {
    const reorderPlaces = vi.fn<PlacesApi['reorderPlaces']>(() => Promise.resolve({ places: THREE }))
    renderPage(stub({ reorderPlaces }))

    const handles = await screen.findAllByRole('button', { name: /^Move / })
    const rows = document.querySelectorAll('.place-row')

    fireEvent.dragStart(handles[2] ?? handles[0]!)
    fireEvent.dragOver(rows[0]!)
    fireEvent.drop(rows[0]!)

    await waitFor(() => expect(reorderPlaces).toHaveBeenCalledWith(['p-3', 'p-1', 'p-2']))
  })

  it('reorders from the keyboard, so a mouse is not required', async () => {
    // The handle is the keyboard route as well as the drag one. A reorder only
    // a pointer can do is one some people here cannot do at all.
    const reorderPlaces = vi.fn<PlacesApi['reorderPlaces']>(() => Promise.resolve({ places: THREE }))
    renderPage(stub({ reorderPlaces }))

    fireEvent.keyDown(await screen.findByRole('button', { name: 'Move Sauna' }), { key: 'ArrowUp' })

    await waitFor(() => expect(reorderPlaces).toHaveBeenCalledWith(['p-2', 'p-1', 'p-3']))
  })

  it('does nothing at the ends rather than sending an unchanged order', async () => {
    const reorderPlaces = vi.fn<PlacesApi['reorderPlaces']>(() => Promise.resolve({ places: THREE }))
    renderPage(stub({ reorderPlaces }))

    fireEvent.keyDown(await screen.findByRole('button', { name: 'Move Temple' }), { key: 'ArrowUp' })
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move Front Lawn' }), { key: 'ArrowDown' })

    expect(reorderPlaces).not.toHaveBeenCalled()
  })

  it('ignores a key that is not up or down', async () => {
    const reorderPlaces = vi.fn<PlacesApi['reorderPlaces']>(() => Promise.resolve({ places: THREE }))
    renderPage(stub({ reorderPlaces }))

    fireEvent.keyDown(await screen.findByRole('button', { name: 'Move Sauna' }), { key: 'Enter' })

    expect(reorderPlaces).not.toHaveBeenCalled()
  })

  it('shows what the server said when a write is refused', async () => {
    renderPage(stub({ deletePlace: () => Promise.reject(apiError(409, 'conflict', 'Still in use.')) }))

    fireEvent.click(await screen.findByRole('button', { name: 'Remove Sauna' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Still in use.')
  })

  it('surfaces a failure to load', async () => {
    renderPage(stub({ getPlaces: () => Promise.reject(new Error('nope')) }))

    expect((await screen.findByRole('alert')).textContent).toContain('Could not load')
  })

  it('offers nothing to someone who is not an organiser', async () => {
    const getPlaces = vi.fn<PlacesApi['getPlaces']>(() => Promise.resolve({ places: THREE }))
    renderPage(stub({ getPlaces }), { status: 'signed-out' })

    expect(screen.getByText(/for organisers/)).toBeTruthy()
    expect(getPlaces).not.toHaveBeenCalled()
  })
})
