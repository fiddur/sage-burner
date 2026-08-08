import { describe, expect, it } from 'vitest'

import { createEmailQueue } from './queue.ts'

/** A promise somebody else settles, which is what a slow relay looks like from here. */
const held = () => {
  let settle: () => void = () => undefined
  const promise = new Promise<void>((resolve) => (settle = resolve))

  return { promise, settle: () => settle() }
}

describe('the queue the email leg goes on', () => {
  it('hands back before the work has run', () => {
    const queue = createEmailQueue(() => undefined)
    let ran = false

    queue.defer(async () => {
      ran = true
      return await Promise.resolve()
    })

    // The whole point: the request that caused this has already answered.
    expect(ran).toBe(false)
  })

  it('runs one at a time, so a burn does not dial the relay forty-two times at once', async () => {
    const queue = createEmailQueue(() => undefined)
    const first = held()
    const started: number[] = []

    queue.defer(async () => {
      started.push(1)
      await first.promise
    })
    queue.defer(async () => {
      started.push(2)
      return await Promise.resolve()
    })

    await Promise.resolve()
    expect(started).toEqual([1])

    first.settle()
    await queue.drain()

    expect(started).toEqual([1, 2])
  })

  it('keeps going after one fails, and says which', async () => {
    // A relay that refuses one message must not stop the rest of the burn's.
    const failures: unknown[] = []
    const queue = createEmailQueue((failure) => failures.push(failure))
    let after = false

    queue.defer(() => Promise.reject(new Error('connect ECONNREFUSED')))
    queue.defer(async () => {
      after = true
      return await Promise.resolve()
    })

    await queue.drain()

    expect(after).toBe(true)
    expect(failures).toHaveLength(1)
  })

  it('drains work queued while it was already draining', async () => {
    // A notification queued from inside another one's work would otherwise be missed
    // by a shutdown that had already read the tail.
    const queue = createEmailQueue(() => undefined)
    let inner = false

    queue.defer(async () => {
      queue.defer(async () => {
        inner = true
        return await Promise.resolve()
      })
      return await Promise.resolve()
    })

    await queue.drain()
    await queue.drain()

    expect(inner).toBe(true)
  })

  it('is settled when nothing has been asked of it', async () => {
    await expect(createEmailQueue(() => undefined).drain()).resolves.toBeUndefined()
  })
})
