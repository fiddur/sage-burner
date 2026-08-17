import type { MyBurn, Place } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { PlacesApi } from './Places.tsx'

import { apiError } from '../api/client.ts'
import { BurnProvider } from '../burn.tsx'
import { ViewerProvider } from '../viewer.tsx'
import { Places } from './Places.tsx'

afterEach(cleanup)

const ADMIN: Viewer = {
  status: 'signed-in',
  account: { id: 'a-1', name: null, avatar: null, roles: ['admin'] },
}

const BURN = {
  id: 'e-1',
  name: 'Summer burn',
  slug: 'summer-burn',
  start_date: '2026-08-01',
  end_date: '2026-08-05',
  start_time: '16:00',
  end_time: '12:00',
  welcome_markdown: '',
  payment_info_markdown: '',
  transfer_info_markdown: '',
  member_cap: 42,
  created_at: '2026-07-02T00:00:00.000Z',
}

const aPlace = (over: Partial<Place> & Pick<Place, 'id' | 'name'>): Place => ({
  event_id: 'e-1',
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
  getPlaceSources: () => Promise.resolve({ sources: [] }),
  addPlace: () => Promise.reject(new Error('addPlace is not stubbed here')),
  updatePlace: () => Promise.reject(new Error('updatePlace is not stubbed here')),
  deletePlace: () => Promise.reject(new Error('deletePlace is not stubbed here')),
  reorderPlaces: () => Promise.reject(new Error('reorderPlaces is not stubbed here')),
  copyPlaces: () => Promise.reject(new Error('copyPlaces is not stubbed here')),
  ...over,
})

const CHOSEN: MyBurn = { event: BURN, attendance: null }

const renderPage = (api: PlacesApi, viewer: Viewer = ADMIN, burn: MyBurn | null = CHOSEN) =>
  render(
    <ViewerProvider viewer={viewer}>
      <BurnProvider
        value={{ status: 'ready', burns: burn === null ? [] : [burn], selected: burn ?? undefined }}
      >
        <Places api={api} />
      </BurnProvider>
    </ViewerProvider>,
  )

const rowNames = () => [...document.querySelectorAll('.reorder-name')].map((node) => node.textContent)

describe('Places', () => {
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
      expect(addPlace).toHaveBeenCalledWith('e-1', { name: 'Sexy Field', emoji: '🌸', color: 'purple' }),
    )
  })

  it('refuses to add one without a name or an emoji, rather than letting the server say no', async () => {
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

  it('refuses to save an edit that empties a field, with the message adding gives', async () => {
    const updatePlace = vi.fn<PlacesApi['updatePlace']>(() =>
      Promise.resolve({ place: aPlace({ id: 'p-2', name: 'x' }) }),
    )
    renderPage(stub({ updatePlace }))

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Sauna' }))
    fireEvent.input(screen.getByRole('textbox', { name: 'Name of Sauna' }), { target: { value: '  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect((await screen.findByRole('alert')).textContent).toContain('needs a name and an emoji')
    expect(updatePlace).not.toHaveBeenCalled()
  })

  it('removes one behind the trashcan', async () => {
    const deletePlace = vi.fn<PlacesApi['deletePlace']>(() => Promise.resolve(undefined))
    renderPage(stub({ deletePlace }))

    fireEvent.click(await screen.findByRole('button', { name: 'Remove Sauna' }))
    fireEvent.click(screen.getByRole('button', { name: 'Really remove Sauna' }))

    await waitFor(() => expect(deletePlace).toHaveBeenCalledWith('p-2'))
  })

  it('reorders by dragging a row onto another', async () => {
    const reorderPlaces = vi.fn<PlacesApi['reorderPlaces']>(() => Promise.resolve({ places: THREE }))
    renderPage(stub({ reorderPlaces }))

    const handle = await screen.findByRole('button', { name: 'Move Front Lawn' })
    const rows = document.querySelectorAll('.reorder-row')

    fireEvent.dragStart(handle)
    fireEvent.dragOver(rows[0]!)
    fireEvent.drop(rows[0]!)

    await waitFor(() => expect(reorderPlaces).toHaveBeenCalledWith('e-1', ['p-3', 'p-1', 'p-2']))
  })

  it('moves a row with the buttons, which is the only way on a phone', async () => {
    const reorderPlaces = vi.fn<PlacesApi['reorderPlaces']>(() => Promise.resolve({ places: THREE }))
    renderPage(stub({ reorderPlaces }))

    fireEvent.click(await screen.findByRole('button', { name: 'Move Sauna up' }))

    await waitFor(() => expect(reorderPlaces).toHaveBeenCalledWith('e-1', ['p-2', 'p-1', 'p-3']))
  })

  it('offers no way past either end', async () => {
    renderPage(stub())

    expect((await screen.findByRole('button', { name: 'Move Temple up' })).hasAttribute('disabled')).toBe(
      true,
    )
    expect(screen.getByRole('button', { name: 'Move Front Lawn down' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Move Sauna up' }).hasAttribute('disabled')).toBe(false)
  })

  it('writes to the drag data store, which Firefox needs to start a drag at all', async () => {
    const setData = vi.fn()
    renderPage(stub())

    fireEvent.dragStart(await screen.findByRole('button', { name: 'Move Temple' }), {
      dataTransfer: { setData },
    })

    expect(setData).toHaveBeenCalledWith('text/plain', 'p-1')
  })

  it('reorders from the keyboard, so a mouse is not required', async () => {
    const reorderPlaces = vi.fn<PlacesApi['reorderPlaces']>(() => Promise.resolve({ places: THREE }))
    renderPage(stub({ reorderPlaces }))

    fireEvent.keyDown(await screen.findByRole('button', { name: 'Move Sauna' }), { key: 'ArrowUp' })

    await waitFor(() => expect(reorderPlaces).toHaveBeenCalledWith('e-1', ['p-2', 'p-1', 'p-3']))
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
    fireEvent.click(screen.getByRole('button', { name: 'Really remove Sauna' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Still in use.')
  })

  it('surfaces a failure to load', async () => {
    renderPage(stub({ getPlaces: () => Promise.reject(new Error('nope')) }))

    expect((await screen.findByRole('alert')).textContent).toContain('Could not load')
  })

  it('offers nothing to someone signed out', async () => {
    const getPlaces = vi.fn<PlacesApi['getPlaces']>(() => Promise.resolve({ places: THREE }))
    renderPage(stub({ getPlaces }), { status: 'signed-out' })

    expect(screen.getByText(/for members/)).toBeTruthy()
    expect(getPlaces).not.toHaveBeenCalled()
  })

  it('offers nothing to a signed-in account with no roles', async () => {
    const getPlaces = vi.fn<PlacesApi['getPlaces']>(() => Promise.resolve({ places: THREE }))
    renderPage(stub({ getPlaces }), {
      status: 'signed-in',
      account: { id: 'a-9', name: null, avatar: null, roles: [] },
    })

    expect(screen.getByText(/for members/)).toBeTruthy()
    expect(getPlaces).not.toHaveBeenCalled()
  })

  it('offers the lanes to a member who is not an admin', async () => {
    renderPage(stub(), {
      status: 'signed-in',
      account: { id: 'a-2', name: null, avatar: null, roles: ['member'] },
    })

    expect(await screen.findByText('Temple')).toBeTruthy()
  })

  it('asks the open burn for its own lanes, not for a global list', async () => {
    const getPlaces = vi.fn<PlacesApi['getPlaces']>(() => Promise.resolve({ places: THREE }))
    renderPage(stub({ getPlaces }))

    expect(await screen.findByText('Temple')).toBeTruthy()
    expect(getPlaces).toHaveBeenCalledWith('e-1', expect.anything())
  })

  it('says there is no grid to lay out when no burn is coming up', async () => {
    const getPlaces = vi.fn<PlacesApi['getPlaces']>(() => Promise.resolve({ places: [] }))
    renderPage(stub({ getPlaces }), ADMIN, null)

    expect(await screen.findByText(/no burn planned yet/)).toBeTruthy()
    expect(getPlaces).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull()
  })

  it('offers a previous burn only while this grid is empty', async () => {
    const copyPlaces = vi.fn<PlacesApi['copyPlaces']>(() => Promise.resolve({ places: THREE }))
    const sources = { sources: [{ event_id: 'e-0', name: 'Last summer', count: 3 }] }
    const { unmount } = renderPage(stub({ copyPlaces, getPlaceSources: () => Promise.resolve(sources) }, []))

    expect(await screen.findByText('The lanes, not the dreams standing in them.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Copy those places' }))
    await waitFor(() => {
      expect(copyPlaces).toHaveBeenCalledWith('e-1', 'e-0')
    })
    unmount()

    renderPage(stub({ getPlaceSources: () => Promise.resolve(sources) }, THREE))

    expect(await screen.findByText('Temple')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Copy those places' })).toBeNull()
  })
})
