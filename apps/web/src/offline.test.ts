import { describe, expect, it } from 'vitest'

import { forgetCachedMemberData, registerServiceWorker, SERVICE_WORKER_URL } from './offline.ts'
import { API_CACHE, SHELL_CACHE } from './sw/cache.ts'

describe('registering the worker', () => {
  it('claims the site root, which is the only scope that covers every page', () => {
    const asked: string[] = []
    registerServiceWorker({
      register: (url: string) => {
        asked.push(url)
        return Promise.resolve(undefined)
      },
    })

    expect(asked).toEqual([SERVICE_WORKER_URL])
    expect(SERVICE_WORKER_URL).toBe('/sw.js')
  })

  it('says nothing when the browser has no workers', () => {
    // An insecure context, or a browser with them turned off. The app works; it just
    // will not work offline, and a message about that helps nobody.
    expect(() => registerServiceWorker(undefined)).not.toThrow()
  })

  it('swallows a registration that fails', () => {
    expect(() =>
      registerServiceWorker({ register: () => Promise.reject(new Error('insecure context')) }),
    ).not.toThrow()
  })
})

describe('forgetting member data on the way out', () => {
  it('deletes what the roster and the schedule were cached in', async () => {
    const deleted: string[] = []

    await forgetCachedMemberData({
      delete: (name: string) => {
        deleted.push(name)
        return Promise.resolve(true)
      },
    })

    expect(deleted).toEqual([API_CACHE])
  })

  it('leaves the app itself installed', async () => {
    // The two caches exist to be treated differently: dropping the shell would mean
    // the next person to open this offline gets nothing at all, and none of it is
    // anybody's data.
    const deleted: string[] = []
    await forgetCachedMemberData({
      delete: (name: string) => {
        deleted.push(name)
        return Promise.resolve(true)
      },
    })

    expect(deleted).not.toContain(SHELL_CACHE)
  })

  it('does not fail a sign-out because a cache would not open', async () => {
    await expect(
      forgetCachedMemberData({
        delete: () => Promise.reject(new Error('no storage')),
      }),
    ).resolves.toBe(false)
  })

  it('is content with a browser that has no cache storage', async () => {
    await expect(forgetCachedMemberData(undefined)).resolves.toBe(false)
  })
})
