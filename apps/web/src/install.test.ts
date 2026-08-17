import { describe, expect, it, vi } from 'vitest'

import {
  DISMISSED_KEY,
  dismissedInstall,
  dismissInstall,
  hasInstallOffer,
  isStandalone,
  offerIn,
  watchInstalls,
} from './install.ts'

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
    expect(calls).toEqual(['prevented'])
  })

  it('tells whoever is watching, so a strip that already rendered appears', () => {
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
    const page = aPage()

    watchInstalls({ listen: page.listen, installed: () => true })

    expect(page.listening()).toEqual([])
  })

  it('listens for both halves when it is not', () => {
    const page = aPage()

    watchInstalls({ listen: page.listen, installed: () => false })

    expect(page.listening()).toEqual(['appinstalled', 'beforeinstallprompt'])
  })

  it('says whether it is the installed copy, which the strip asks at render', () => {
    const page = aPage()

    expect(watchInstalls({ listen: page.listen, installed: () => true }).standalone()).toBe(true)
    expect(watchInstalls({ listen: page.listen, installed: () => false }).standalone()).toBe(false)
  })

  it('says whether the browser makes the offer itself, which is the other thing it asks', () => {
    const page = aPage()

    expect(
      watchInstalls({ listen: page.listen, installed: () => false, offers: () => true }).offersItself(),
    ).toBe(true)
    expect(
      watchInstalls({ listen: page.listen, installed: () => false, offers: () => false }).offersItself(),
    ).toBe(false)
  })
})

describe('telling a browser with the offer API from one without', () => {
  it('is whether the window carries the property, present or null either way', () => {
    expect(hasInstallOffer({ onbeforeinstallprompt: null })).toBe(true)
    expect(hasInstallOffer({ onbeforeinstallprompt: () => undefined })).toBe(true)
    expect(hasInstallOffer({})).toBe(false)
  })
})

describe('telling the installed copy from a browser tab', () => {
  const withMatchMedia = (matches: boolean) =>
    vi.spyOn(globalThis, 'matchMedia').mockReturnValue({ matches } as MediaQueryList)

  it('takes the display mode when the browser has one', () => {
    const media = withMatchMedia(true)

    expect(isStandalone()).toBe(true)

    media.mockRestore()
  })

  it('takes the legacy flag as well, which is all older iOS answers', () => {
    const media = withMatchMedia(false)
    Object.defineProperty(globalThis.navigator, 'standalone', { value: true, configurable: true })

    expect(isStandalone()).toBe(true)

    Reflect.deleteProperty(globalThis.navigator, 'standalone')
    media.mockRestore()
  })

  it('is a browser tab when neither says otherwise', () => {
    const media = withMatchMedia(false)

    expect(isStandalone()).toBe(false)

    media.mockRestore()
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
    expect(store.getItem(DISMISSED_KEY)).not.toBeNull()
  })

  it('says no rather than throwing when reading the property itself throws', () => {
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
