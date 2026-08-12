import type { NotificationsResponse } from '@sage-burner/shared'

import { describe, expect, it, vi } from 'vitest'

import type { ShownApi } from './shown.tsx'

import { createShown } from './shown.tsx'

const NOTHING_UNSEEN: NotificationsResponse = { notifications: [], unseen: 0 }

const anApi = (over: Partial<ShownApi> = {}) => {
  const markTargetShown = vi.fn<ShownApi['markTargetShown']>(() => Promise.resolve(NOTHING_UNSEEN))

  return {
    markTargetShown,
    api: { readAt: () => '2026-08-12T10:00:00.000Z', markTargetShown, ...over } satisfies ShownApi,
  }
}

const aSignal = () => new AbortController().signal

describe('reporting that a notification’s target was shown', () => {
  it('reports the address with the moment the server answered the read behind it', async () => {
    const { api, markTargetShown } = anApi()

    createShown(api).report('/changelog', aSignal())

    await vi.waitFor(() =>
      expect(markTargetShown).toHaveBeenCalledWith({
        link: '/changelog',
        as_of: '2026-08-12T10:00:00.000Z',
      }),
    )
  })

  it('says nothing where no read answered with a date, the claim having nothing behind it', () => {
    const { api, markTargetShown } = anApi({ readAt: () => undefined })

    createShown(api).report('/changelog', aSignal())

    expect(markTargetShown).not.toHaveBeenCalled()
  })

  it('says nothing for an address it does not have', () => {
    const { api, markTargetShown } = anApi()

    createShown(api).report('', aSignal())

    expect(markTargetShown).not.toHaveBeenCalled()
  })

  it('does not repeat a claim already made, which several loads on one page would', async () => {
    const { api, markTargetShown } = anApi()
    const shown = createShown(api)

    shown.report('/changelog', aSignal())
    shown.report('/changelog', aSignal())

    await vi.waitFor(() => expect(markTargetShown).toHaveBeenCalledTimes(1))
  })

  it('reports again once the page has read something newer', async () => {
    let at = '2026-08-12T10:00:00.000Z'
    const { api, markTargetShown } = anApi({ readAt: () => at })
    const shown = createShown(api)

    shown.report('/changelog', aSignal())
    at = '2026-08-12T10:01:00.000Z'
    shown.report('/changelog', aSignal())

    await vi.waitFor(() => expect(markTargetShown).toHaveBeenCalledTimes(2))
    expect(markTargetShown.mock.calls[1]?.[0]).toEqual({
      link: '/changelog',
      as_of: '2026-08-12T10:01:00.000Z',
    })
  })

  it('keeps one page’s claim from silencing another’s', async () => {
    const { api, markTargetShown } = anApi()
    const shown = createShown(api)

    shown.report('/changelog', aSignal())
    shown.report('/feed', aSignal())

    await vi.waitFor(() => expect(markTargetShown).toHaveBeenCalledTimes(2))
  })

  it('hands what the server answered to whoever is watching, so the bell stops badging', async () => {
    const seen = { notifications: [], unseen: 3 } satisfies NotificationsResponse
    const { api } = anApi({ markTargetShown: () => Promise.resolve(seen) })
    const shown = createShown(api)
    const heard = vi.fn()
    shown.subscribe(heard)

    shown.report('/changelog', aSignal())

    await vi.waitFor(() => expect(heard).toHaveBeenCalledWith(seen))
  })

  it('stops telling somebody who has unsubscribed', async () => {
    const { api, markTargetShown } = anApi()
    const shown = createShown(api)
    const heard = vi.fn()

    shown.subscribe(heard)()
    shown.report('/changelog', aSignal())

    await vi.waitFor(() => expect(markTargetShown).toHaveBeenCalled())
    expect(heard).not.toHaveBeenCalled()
  })

  it('swallows a failed report, and lets the next load try again', async () => {
    const markTargetShown = vi
      .fn<ShownApi['markTargetShown']>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(NOTHING_UNSEEN)
    const shown = createShown({ readAt: () => '2026-08-12T10:00:00.000Z', markTargetShown })

    shown.report('/changelog', aSignal())
    await vi.waitFor(() => expect(markTargetShown).toHaveBeenCalledTimes(1))

    await vi.waitFor(() => {
      shown.report('/changelog', aSignal())
      expect(markTargetShown).toHaveBeenCalledTimes(2)
    })
  })
})
