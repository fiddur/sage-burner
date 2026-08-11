import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MapApi } from './MapField.tsx'

import { MapField } from './MapField.tsx'

afterEach(cleanup)

const MAP = 'https://maps.example.org/the-field'

const stub = (over: Partial<MapApi> = {}): MapApi => ({
  getMapLink: () => Promise.resolve({ map: { url: null } }),
  setMapLink: () => Promise.reject(new Error('setMapLink is not stubbed here')),
  ...over,
})

const box = async () => await screen.findByLabelText('Map of the area')

describe('the map link an admin sets', () => {
  it('opens on the address already stored', async () => {
    render(<MapField api={stub({ getMapLink: () => Promise.resolve({ map: { url: MAP } }) })} />)

    expect(await box()).toHaveProperty('value', MAP)
  })

  it('opens empty where nobody has set one', async () => {
    render(<MapField api={stub()} />)

    expect(await box()).toHaveProperty('value', '')
  })

  it('saves what was typed, trimmed', async () => {
    const setMapLink = vi.fn<MapApi['setMapLink']>(() => Promise.resolve({ map: { url: MAP } }))
    render(<MapField api={stub({ setMapLink })} />)

    fireEvent.input(await box(), { target: { value: `  ${MAP}  ` } })
    fireEvent.click(screen.getByRole('button', { name: 'Save the map link' }))

    await waitFor(() => expect(setMapLink).toHaveBeenCalledWith({ url: MAP }))
  })

  it('sends nothing rather than an empty address when the box is cleared', async () => {
    const setMapLink = vi.fn<MapApi['setMapLink']>(() => Promise.resolve({ map: { url: null } }))
    render(<MapField api={stub({ getMapLink: () => Promise.resolve({ map: { url: MAP } }), setMapLink })} />)

    fireEvent.input(await box(), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save the map link' }))

    await waitFor(() => expect(setMapLink).toHaveBeenCalledWith({ url: null }))
  })

  it('says what is wrong with an address the server would refuse, and refuses to send it', async () => {
    const setMapLink = vi.fn<MapApi['setMapLink']>(() => Promise.resolve({ map: { url: null } }))
    render(<MapField api={stub({ setMapLink })} />)

    fireEvent.input(await box(), { target: { value: 'maps.example.org' } })

    expect(await screen.findByText(/has to start with https/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save the map link' })).toHaveProperty('disabled', true)
    expect(setMapLink).not.toHaveBeenCalled()
  })

  it('says so when it has saved', async () => {
    render(<MapField api={stub({ setMapLink: () => Promise.resolve({ map: { url: MAP } }) })} />)

    fireEvent.input(await box(), { target: { value: MAP } })
    fireEvent.click(screen.getByRole('button', { name: 'Save the map link' }))

    expect(await screen.findByText('Saved.')).toBeTruthy()
  })
})
