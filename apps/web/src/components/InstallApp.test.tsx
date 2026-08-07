import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { InstallOffer, InstallWatch } from '../install.ts'

import { DISMISSED_AT } from '../install.ts'
import { InstallApp } from './InstallApp.tsx'

afterEach(() => {
  cleanup()
  globalThis.localStorage?.clear()
})

/** A watch under the test's control, rather than one listening to a real page. */
const aWatch = (start?: InstallOffer) => {
  let offer = start
  const listeners = new Set<() => void>()
  const prompted = vi.fn(() => Promise.resolve(undefined))

  const watch: InstallWatch = {
    offer: () => offer,
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
    /** What the browser deciding the site qualifies looks like from here. */
    offers: () => {
      offer = { prompt: prompted }
      for (const listener of listeners) listener()
    },
  }
}

describe('offering to install the app', () => {
  it('says nothing where the browser has made no offer', () => {
    // Which is Firefox and Safari always, since neither has the API at all.
    render(<InstallApp watch={aWatch().watch} />)

    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull()
  })

  it('says nothing at all in a tree with no watch', () => {
    render(<InstallApp watch={null} />)

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('offers once the browser says the site qualifies', async () => {
    const { watch, offers } = aWatch()
    render(<InstallApp watch={watch} />)

    await act(() => {
      offers()
    })

    expect(screen.getByRole('button', { name: 'Install' })).toBeTruthy()
  })

  it('shows an offer that arrived before it rendered', () => {
    // The race this exists for: `beforeinstallprompt` fires once, and can fire before
    // any component has mounted. A strip that only listened would never appear.
    const { watch } = aWatch({ prompt: () => Promise.resolve(undefined) })

    render(<InstallApp watch={watch} />)

    expect(screen.getByRole('button', { name: 'Install' })).toBeTruthy()
  })

  it('catches an offer that arrives between the first render and the effect', () => {
    // The narrow window `onChange` cannot cover: the subscription is registered in an
    // effect, so an offer landing after the initial render but before that runs fires
    // nothing. The effect re-reads for exactly this.
    //
    // Simulated by call order rather than by timing — the first `offer()` is the
    // `useState` initializer at first render, the second is the effect's re-read.
    let asked = 0
    const watch: InstallWatch = {
      offer: () => (++asked === 1 ? undefined : { prompt: () => Promise.resolve(undefined) }),
      onChange: () => () => undefined,
      taken: () => undefined,
    }

    render(<InstallApp watch={watch} />)

    expect(screen.getByRole('button', { name: 'Install' })).toBeTruthy()
  })

  it('opens the browser’s own flow, and spends the offer', async () => {
    const { watch, offers, prompted } = aWatch()
    render(<InstallApp watch={watch} />)
    await act(() => {
      offers()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Install' }))

    expect(prompted).toHaveBeenCalledTimes(1)
    // One prompt per event, so the strip goes rather than offering a second that the
    // browser would refuse.
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull()
  })

  it('takes no for an answer, and remembers it', async () => {
    const { watch, offers } = aWatch()
    render(<InstallApp watch={watch} />)
    await act(() => {
      offers()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))

    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull()
    expect(globalThis.localStorage.getItem(DISMISSED_AT)).not.toBeNull()
  })

  it('still renders where the browser throws on reading storage', () => {
    // The consequence, not just the read: this is called from `useState` during
    // render and nothing above it is an error boundary, so a throw here paints an
    // empty page instead of the app. Chromium with site data blocked for the origin
    // is where that happens.
    const store = vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    const { watch } = aWatch({ prompt: () => Promise.resolve(undefined) })

    expect(() => render(<InstallApp watch={watch} />)).not.toThrow()
    expect(screen.getByRole('button', { name: 'Install' })).toBeTruthy()

    store.mockRestore()
  })

  it('stays quiet on the next visit after a no', () => {
    // The event fires on every load until the app is installed, so a nudge with no
    // memory is a nudge for ever.
    globalThis.localStorage.setItem(DISMISSED_AT, 'yes')
    const { watch } = aWatch({ prompt: () => Promise.resolve(undefined) })

    render(<InstallApp watch={watch} />)

    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull()
  })

  it('goes away when the offer does, which is what installing looks like', async () => {
    const { watch, offers } = aWatch()
    render(<InstallApp watch={watch} />)
    await act(() => {
      offers()
    })
    expect(screen.getByRole('button', { name: 'Install' })).toBeTruthy()

    await act(() => {
      watch.taken()
    })

    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull()
  })
})
