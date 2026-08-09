import { describe, expect, it } from 'vitest'

import { createFreshness, FRESH_FOR_MS, freshnessAt } from './freshness.ts'
import { CACHED_AT } from './sw/cache.ts'

const NOW = Date.parse('2026-08-06T12:00:00.000Z')

const withStamp = (stamp?: string) =>
  new Response('{}', { headers: stamp === undefined ? {} : { [CACHED_AT]: stamp } })

describe('how old an answer is', () => {
  it('is now, for one that came off the network', () => {
    expect(freshnessAt(withStamp(), NOW)).toBe(NOW)
  })

  it('is when it was fetched, for one the worker had stored', () => {
    // The whole point of the header: offline the page still renders, and this is what
    // stops it claiming the roster it is showing is current.
    expect(freshnessAt(withStamp('2026-08-06T11:40:00.000Z'), NOW)).toBe(
      Date.parse('2026-08-06T11:40:00.000Z'),
    )
  })

  it('falls back to now rather than to the beginning of time', () => {
    // Cannot happen — the worker writes an ISO string — but treating a header it
    // could not read as ancient would pin a banner to the page permanently.
    expect(freshnessAt(withStamp('not a date'), NOW)).toBe(NOW)
  })
})

describe('the newest of those', () => {
  it('starts out knowing nothing', () => {
    expect(createFreshness().latest()).toBeUndefined()
  })

  it('keeps the newest, whatever order they land in', () => {
    const freshness = createFreshness()

    freshness.note(NOW)
    freshness.note(NOW - 60_000)

    expect(freshness.latest()).toBe(NOW)
  })

  it('moves forward when something newer lands', () => {
    // The passing sibling to the test above: one that never moved would also refuse
    // the older value, and would leave the banner up for good.
    const freshness = createFreshness()

    freshness.note(NOW - 60_000)
    freshness.note(NOW)

    expect(freshness.latest()).toBe(NOW)
  })

  it('tells a listener only when the answer changed', () => {
    const freshness = createFreshness()
    let told = 0
    freshness.subscribe(() => {
      told += 1
    })

    freshness.note(NOW)
    freshness.note(NOW - 1000)

    expect(told).toBe(1)
  })

  it('stops telling one that unsubscribed', () => {
    const freshness = createFreshness()
    let told = 0
    const stop = freshness.subscribe(() => {
      told += 1
    })

    stop()
    freshness.note(NOW)

    expect(told).toBe(0)
  })
})

it('calls five minutes the limit', () => {
  expect(FRESH_FOR_MS).toBe(300_000)
})
