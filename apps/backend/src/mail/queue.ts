export interface EmailQueue {
  defer: (work: () => Promise<unknown>) => void
  drain: () => Promise<void>
}

export const DRAIN_DEADLINE_MS = 5000

export const drainWithin = async (queue: EmailQueue, ms = DRAIN_DEADLINE_MS): Promise<void> => {
  await Promise.race([queue.drain(), new Promise<void>((resolve) => setTimeout(resolve, ms).unref())])
}

export const createEmailQueue = (onFailure: (failure: unknown) => void): EmailQueue => {
  let tail: Promise<void> = Promise.resolve()

  return {
    defer: (work) => {
      tail = tail
        .then(async () => {
          await work()
        })
        .catch(onFailure)
    },
    drain: () => tail,
  }
}
