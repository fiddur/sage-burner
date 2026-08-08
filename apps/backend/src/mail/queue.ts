/**
 * Where the email leg of a notification goes so a request does not wait on it (#356).
 *
 * Two problems, one shape. `notifyBurn` fans out over the whole attendance, and
 * `sendWithSmtp` opens a connection per message — so a full burn dialled the relay
 * forty-two times at once, which small relays cap and refuse. And every one of those
 * waits happened *inside* the request that caused it: before #313 that was about ten
 * minutes at the cap, after it one timeout, and one is still one too many for a leg
 * nothing on screen depends on.
 *
 * **One at a time, and after the answer.** Serial because the relay is what has the
 * limit, and being slow costs nothing once nobody is waiting. Nothing here can fail a
 * write — the caller has handed the work over and is not holding it — so a mail server
 * that is down costs a message rather than a record, the rule #30 set and this keeps.
 *
 * Nothing retries. A message that could not be posted is logged and gone, which is the
 * same promise the bell makes: the row is the record, and the email is a copy of it.
 */
export interface EmailQueue {
  /** Put work on the end of the queue. Returns at once; nothing here is awaited. */
  defer: (work: () => Promise<unknown>) => void
  /**
   * Everything queued **as of this call**, run to completion.
   *
   * For shutdown, and for tests — which can no longer assume that a route answering
   * means the posting has happened, because that is exactly what this changed.
   *
   * Work deferred by work already on the queue is not included, so one call is not
   * always enough; nothing in the app does that, and `queue.test.ts` proves the limit
   * by calling it twice rather than leaving it to be discovered.
   */
  drain: () => Promise<void>
}

/**
 * How long a shutdown waits for what is still going out.
 *
 * `smtp.ts` waits up to fifteen seconds on a host that drops packets, so an unbounded
 * drain against a dead relay outlasts a container's stop grace and is SIGKILLed —
 * which is the case that made draining worth doing at all.
 */
export const DRAIN_DEADLINE_MS = 5000

/** The queue, or the deadline, whichever comes first. */
export const drainWithin = async (queue: EmailQueue, ms = DRAIN_DEADLINE_MS): Promise<void> => {
  await Promise.race([queue.drain(), new Promise<void>((resolve) => setTimeout(resolve, ms).unref())])
}

export const createEmailQueue = (onFailure: (failure: unknown) => void): EmailQueue => {
  // The tail of the chain, which is what makes this serial: each `defer` appends to
  // whatever is already outstanding rather than starting beside it.
  let tail: Promise<void> = Promise.resolve()

  return {
    defer: (work) => {
      // `.catch` after the work rather than a rejection handler beside it: the second
      // argument to `then` handles the *previous* link's failure, so a message that
      // could not be posted would take the next one's turn instead of its own.
      tail = tail
        .then(async () => {
          await work()
        })
        .catch(onFailure)
    },
    drain: () => tail,
  }
}
