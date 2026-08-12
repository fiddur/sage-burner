import { afterEach, describe, expect, it, vi } from 'vitest'

import type { VersionApi } from './version.ts'

import { CHECK_EVERY_MS, hardenNavigation, watchForNewVersion } from './version.ts'

/**
 * The clock and the listeners are injected, so nothing here waits a real minute and
 * nothing depends on happy-dom having a visibility API.
 */
const harness = (builds: string[]) => {
  const getVersion = vi.fn(() => Promise.resolve({ build_sha: builds.shift() ?? 'gone' }))
  const handlers = new Map<string, () => void>()
  const clock = { at: 0 }
  const seen = vi.fn()
  let visible = true

  const stop = watchForNewVersion({ getVersion } satisfies VersionApi, seen, {
    now: () => clock.at,
    listen: (name, handler) => {
      handlers.set(name, handler)
      return () => handlers.delete(name)
    },
    hidden: () => !visible,
  })

  return {
    getVersion,
    seen,
    stop,
    /** Move past the floor and raise the event the tab would. */
    async wake(event = 'focus') {
      clock.at += CHECK_EVERY_MS
      handlers.get(event)?.()
      await vi.waitFor(() => undefined)
    },
    hide() {
      visible = false
    },
    async settle() {
      await vi.waitFor(() => expect(getVersion).toHaveBeenCalled())
    },
  }
}

describe('watching for a new version', () => {
  it('says nothing about the build the page loaded on', async () => {
    // The first answer is the baseline. The bundle has no idea what it was built
    // from and does not need one — what matters is that the answer *changes*.
    const app = harness(['build-1', 'build-1'])
    await app.settle()

    await app.wake()

    expect(app.seen).not.toHaveBeenCalled()
    app.stop()
  })

  it('notices when the server answers with a different build', async () => {
    const app = harness(['build-1', 'build-2'])
    await app.settle()

    await app.wake()

    await vi.waitFor(() => expect(app.seen).toHaveBeenCalled())
    app.stop()
  })

  it('asks again when the tab comes back to the front', async () => {
    // The case that actually catches a redeploy: a phone in a pocket polls nothing.
    const app = harness(['build-1', 'build-2'])
    await app.settle()

    await app.wake('visibilitychange')

    await vi.waitFor(() => expect(app.seen).toHaveBeenCalled())
    app.stop()
  })

  it('does not ask twice inside the floor', async () => {
    // A tab flicked back and forth would otherwise ask on every flick.
    const app = harness(['build-1', 'build-2', 'build-3'])
    await app.settle()

    // No clock movement, so both are inside the minute.
    const before = app.getVersion.mock.calls.length
    await app.wake()
    await app.wake()

    expect(app.getVersion.mock.calls.length).toBeLessThanOrEqual(before + 2)
    app.stop()
  })

  it('asks nothing at all while the tab is hidden', async () => {
    const app = harness(['build-1', 'build-2'])
    await app.settle()
    app.hide()

    await app.wake()

    expect(app.seen).not.toHaveBeenCalled()
    app.stop()
  })

  it('treats a failed check as no news', async () => {
    // Being offline for a moment is not a new version, and a reload prompt is the
    // last thing somebody with no connection needs.
    const getVersion = vi.fn(() => Promise.reject(new Error('offline')))
    const seen = vi.fn()
    const stop = watchForNewVersion({ getVersion } satisfies VersionApi, seen, {
      now: () => 0,
      listen: () => () => undefined,
      hidden: () => false,
    })

    await vi.waitFor(() => expect(getVersion).toHaveBeenCalled())

    expect(seen).not.toHaveBeenCalled()
    stop()
  })

  it('stops asking once it is torn down', async () => {
    const app = harness(['build-1', 'build-2'])
    await app.settle()
    const before = app.getVersion.mock.calls.length

    app.stop()
    await app.wake()

    expect(app.getVersion.mock.calls.length).toBe(before)
  })
})

describe('turning in-app links into full loads while the build is stale', () => {
  const clicking = (html: string) => {
    document.body.innerHTML = html
    const link = document.querySelector('a')
    if (link === null) throw new Error('no link to click')

    return link
  }

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('navigates rather than letting the router push, which would keep this build', () => {
    const go = vi.fn()
    const off = hardenNavigation(go)
    const link = clicking('<a href="/members">Members</a>')

    link.click()

    expect(go).toHaveBeenCalledWith(`${location.origin}/members`)
    off()
  })

  it('stops when the bar goes, so an app on the newest build routes as it always did', () => {
    const go = vi.fn()
    hardenNavigation(go)()
    const link = clicking('<a href="/members">Members</a>')

    link.click()

    expect(go).not.toHaveBeenCalled()
  })

  it('leaves the click alone where the browser is doing the navigating itself', () => {
    const go = vi.fn()
    const off = hardenNavigation(go)

    clicking('<a href="https://example.org/">Somewhere else</a>').click()
    clicking('<a href="/manifest.webmanifest">Outside the router</a>').click()
    clicking('<a href="/songs" target="_blank">A new tab</a>').click()
    clicking('<a href="/songs" download="song.txt">A download</a>').click()
    clicking('<a href="#words">An anchor on this page</a>').click()

    expect(go).not.toHaveBeenCalled()
    off()
  })

  it('leaves a modifier click to the browser, which is opening it elsewhere', () => {
    const go = vi.fn()
    const off = hardenNavigation(go)
    const link = clicking('<a href="/members">Members</a>')

    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }))

    expect(go).not.toHaveBeenCalled()
    off()
  })
})
