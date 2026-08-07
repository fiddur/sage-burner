import { describe, expect, it, vi } from 'vitest'

import { DISMISSED_AT, dismissedInstall, dismissInstall, offerIn, watchInstalls } from './install.ts'

/** A page that records what it was asked to listen for, and can fire it. */
const aPage = () => {
  const handlers = new Map<string, (event: Event) => void>()

  return {
    listening: () => [...handlers.keys()].sort(),
    fire: (name: string, event: unknown) => handlers.get(name)?.(event as Event),
    listen: (name: string, handler: (event: Event) => void) => {
      handlers.set(name, handler)
      return () => handlers.delete(name)
    },
  }
}

/** What Chromium hands over, minus everything this app does not touch. */
const anEvent = () => {
  const calls: string[] = []

  return {
    calls,
    event: {
      preventDefault: () => calls.push('prevented'),
      prompt() {
        calls.push('prompted')
        return Promise.resolve({ outcome: 'accepted' })
      },
    },
  }
}

describe('reading the browser’s offer', () => {
  it('takes the one method it uses', async () => {
    const { event, calls } = anEvent()

    await offerIn(event)?.prompt()

    expect(calls).toEqual(['prompted'])
  })

  it('calls it on the event, not detached from it', async () => {
    // `prompt()` is a method on the event; Chrome throws an illegal invocation if it
    // is pulled off and called on its own.
    const seen: unknown[] = []
    const event = {
      marker: 'the event',
      prompt(this: unknown) {
        seen.push(this)
        return Promise.resolve(undefined)
      },
    }

    await offerIn(event)?.prompt()

    expect(seen).toEqual([event])
  })

  it('answers with nothing for anything that is not one', () => {
    expect(offerIn(undefined)).toBeUndefined()
    expect(offerIn(null)).toBeUndefined()
    expect(offerIn('an event')).toBeUndefined()
    expect(offerIn({})).toBeUndefined()
    expect(offerIn({ prompt: 'not a function' })).toBeUndefined()
  })
})

describe('watching for an install offer', () => {
  it('has nothing to offer until the browser makes one', () => {
    const page = aPage()

    expect(watchInstalls({ listen: page.listen, installed: () => false }).offer()).toBeUndefined()
  })

  it('holds the offer the browser makes, and stops its own bar', () => {
    const page = aPage()
    const watch = watchInstalls({ listen: page.listen, installed: () => false })
    const { event, calls } = anEvent()

    page.fire('beforeinstallprompt', event)

    expect(watch.offer()).toBeTruthy()
    // Without this Chrome shows its own bar as well, saying the same thing twice.
    expect(calls).toEqual(['prevented'])
  })

  it('tells whoever is watching, so a strip that already rendered appears', () => {
    // The whole reason this is an object watched from before the first render: the
    // event fires once, and a component mounting later would never hear it.
    const page = aPage()
    const watch = watchInstalls({ listen: page.listen, installed: () => false })
    const heard = vi.fn()
    watch.onChange(heard)

    page.fire('beforeinstallprompt', anEvent().event)

    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('stops telling somebody who has unsubscribed', () => {
    const page = aPage()
    const watch = watchInstalls({ listen: page.listen, installed: () => false })
    const heard = vi.fn()

    watch.onChange(heard)()
    page.fire('beforeinstallprompt', anEvent().event)

    expect(heard).not.toHaveBeenCalled()
  })

  it('drops the offer once the app has been installed', () => {
    const page = aPage()
    const watch = watchInstalls({ listen: page.listen, installed: () => false })
    page.fire('beforeinstallprompt', anEvent().event)

    page.fire('appinstalled', {})

    expect(watch.offer()).toBeUndefined()
  })

  it('drops it once it has been used, since it may be prompted once', () => {
    const page = aPage()
    const watch = watchInstalls({ listen: page.listen, installed: () => false })
    page.fire('beforeinstallprompt', anEvent().event)

    watch.taken()

    expect(watch.offer()).toBeUndefined()
  })

  it('does not listen at all when the app is already the installed copy', () => {
    // The browser would not fire it anyway; not asking spares a listener that could
    // never be useful, and says so where somebody reads the code.
    const page = aPage()

    watchInstalls({ listen: page.listen, installed: () => true })

    expect(page.listening()).toEqual([])
  })

  it('listens for both halves when it is not', () => {
    // The passing sibling: never listening would satisfy the test above.
    const page = aPage()

    watchInstalls({ listen: page.listen, installed: () => false })

    expect(page.listening()).toEqual(['appinstalled', 'beforeinstallprompt'])
  })
})

describe('remembering a no', () => {
  const aStore = (start: Record<string, string> = {}) => {
    const held = new Map(Object.entries(start))

    return {
      getItem: (key: string) => held.get(key) ?? null,
      setItem: (key: string, value: string) => held.set(key, value),
    } as unknown as Storage
  }

  it('has not been dismissed until it is', () => {
    expect(dismissedInstall(aStore())).toBe(false)
  })

  it('remembers a dismissal under a key the next visit reads', () => {
    const store = aStore()

    dismissInstall(store)

    expect(dismissedInstall(store)).toBe(true)
    expect(store.getItem(DISMISSED_AT)).not.toBeNull()
  })

  it('says no rather than throwing when reading the property itself throws', () => {
    // Chromium with site data blocked for the origin, and Brave's "block all
    // cookies": `globalThis.localStorage` is a *getter* that throws `SecurityError`.
    // This is read during `InstallApp`'s render, and there is no error boundary, so a
    // throw here paints nothing at all.
    const store = vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('SecurityError')
    })

    expect(() => dismissedInstall()).not.toThrow()
    expect(dismissedInstall()).toBe(false)
    expect(() => dismissInstall()).not.toThrow()

    store.mockRestore()
  })

  it('says no when there is no storage at all, rather than reading absence as a yes', () => {
    const store = vi.spyOn(globalThis, 'localStorage', 'get').mockReturnValue(undefined as unknown as Storage)

    expect(dismissedInstall()).toBe(false)

    store.mockRestore()
  })

  it('says no rather than throwing where storage is blocked', () => {
    // Safari in private mode and anything with site data turned off. A page that will
    // not render is a worse answer than a nudge dismissed twice.
    const blocked = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    } as unknown as Storage

    expect(dismissedInstall(blocked)).toBe(false)
    expect(() => dismissInstall(blocked)).not.toThrow()
  })
})
