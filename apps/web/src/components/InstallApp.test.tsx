import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { InstallOffer, InstallWatch } from '../install.ts'

import { DISMISSED_KEY } from '../install.ts'
import { ViewerProvider } from '../viewer.tsx'
import { InstallApp } from './InstallApp.tsx'

afterEach(() => {
  cleanup()
  globalThis.localStorage?.clear()
})

const aWatch = ({
  start,
  standalone = false,
  offersItself = false,
}: { start?: InstallOffer; standalone?: boolean; offersItself?: boolean } = {}) => {
  let offer = start
  const listeners = new Set<() => void>()
  const prompted = vi.fn(() => Promise.resolve(undefined))

  const watch: InstallWatch = {
    offer: () => offer,
    offersItself: () => offersItself,
    standalone: () => standalone,
    onChange: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    taken: () => {
      offer = undefined
      for (const listener of listeners) listener()
    },
  }

  return {
    watch,
    prompted,
    offers: () => {
      offer = { prompt: prompted }
      for (const listener of listeners) listener()
    },
  }
}

describe('offering to install the app', () => {
  it('says how by hand where the browser has made no offer', () => {
    render(<InstallApp watch={aWatch().watch} />)

    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('Add to Home Screen')
  })

  it('says nothing where the browser makes the offer itself and has not yet', () => {
    render(<InstallApp watch={aWatch({ offersItself: true }).watch} />)

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('says nothing to the installed copy, however it answers being asked', () => {
    render(<InstallApp watch={aWatch({ standalone: true }).watch} />)

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('takes no for an answer to the instructions too, which is one decision', async () => {
    render(<InstallApp watch={aWatch().watch} />)

    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))

    await act(() => Promise.resolve())
    expect(screen.queryByRole('status')).toBeNull()
    expect(globalThis.localStorage.getItem(DISMISSED_KEY)).not.toBeNull()
  })

  it('points a member at the FAQ, where a walkthrough can be edited without a deploy', () => {
    render(
      <ViewerProvider
        viewer={{
          status: 'signed-in',
          account: { id: 'a-1', name: 'Ada', avatar: null, roles: ['member'] },
        }}
      >
        <InstallApp watch={aWatch().watch} />
      </ViewerProvider>,
    )

    expect(screen.getByRole('link', { name: 'More in the FAQ.' }).getAttribute('href')).toBe('/faq')
  })

  it('offers a signed-out visitor no FAQ link, which they could not read', () => {
    render(<InstallApp watch={aWatch().watch} />)

    expect(screen.queryByRole('link', { name: 'More in the FAQ.' })).toBeNull()
  })

  it('says nothing at all in a tree with no watch', () => {
    render(<InstallApp watch={null} />)

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('offers once the browser says the site qualifies', async () => {
    const { watch, offers } = aWatch({ offersItself: true })
    render(<InstallApp watch={watch} />)

    await act(() => {
      offers()
    })

    expect(screen.getByRole('button', { name: 'Install' })).toBeTruthy()
  })

  it('shows an offer that arrived before it rendered', () => {
    const { watch } = aWatch({ start: { prompt: () => Promise.resolve(undefined) }, offersItself: true })

    render(<InstallApp watch={watch} />)

    expect(screen.getByRole('button', { name: 'Install' })).toBeTruthy()
  })

  it('catches an offer that arrives between the first render and the effect', () => {
    let asked = 0
    const watch: InstallWatch = {
      offer: () => (++asked === 1 ? undefined : { prompt: () => Promise.resolve(undefined) }),
      offersItself: () => true,
      standalone: () => false,
      onChange: () => () => undefined,
      taken: () => undefined,
    }

    render(<InstallApp watch={watch} />)

    expect(screen.getByRole('button', { name: 'Install' })).toBeTruthy()
  })

  it('opens the browser’s own flow, and spends the offer', async () => {
    const { watch, offers, prompted } = aWatch({ offersItself: true })
    render(<InstallApp watch={watch} />)
    await act(() => {
      offers()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Install' }))

    expect(prompted).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull()
  })

  it('goes quiet after the prompt rather than telling somebody to do it by hand', async () => {
    const { watch, offers } = aWatch({ offersItself: true })
    render(<InstallApp watch={watch} />)
    await act(() => {
      offers()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Install' }))

    await act(() => Promise.resolve())
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('takes no for an answer, and remembers it', async () => {
    const { watch, offers } = aWatch({ offersItself: true })
    render(<InstallApp watch={watch} />)
    await act(() => {
      offers()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))

    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull()
    expect(globalThis.localStorage.getItem(DISMISSED_KEY)).not.toBeNull()
  })

  it('still renders where the browser throws on reading storage', () => {
    const store = vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    const { watch } = aWatch({ start: { prompt: () => Promise.resolve(undefined) }, offersItself: true })

    expect(() => render(<InstallApp watch={watch} />)).not.toThrow()
    expect(screen.getByRole('button', { name: 'Install' })).toBeTruthy()

    store.mockRestore()
  })

  it('stays quiet on the next visit after a no', () => {
    globalThis.localStorage.setItem(DISMISSED_KEY, 'yes')
    const { watch } = aWatch({ start: { prompt: () => Promise.resolve(undefined) }, offersItself: true })

    render(<InstallApp watch={watch} />)

    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('goes away when the offer does, which is what installing looks like', async () => {
    const { watch, offers } = aWatch({ offersItself: true })
    render(<InstallApp watch={watch} />)
    await act(() => {
      offers()
    })
    expect(screen.getByRole('button', { name: 'Install' })).toBeTruthy()

    await act(() => {
      watch.taken()
    })

    expect(screen.queryByRole('status')).toBeNull()
  })
})
