export interface GateOptions {
  slots: number
  queue: number
  timeoutMs: number
  setTimer?: (fn: () => void, ms: number) => { clear: () => void }
}

export const SCRYPT_GATE: GateOptions = { slots: 2, queue: 8, timeoutMs: 5000 }

export type Refusal = 'queue-full' | 'timed-out'

export type Admission = { ok: true; release: () => void } | { ok: false; reason: Refusal }

export interface Gate {
  enter: () => Promise<Admission>
  retryAfter: (reason: Refusal) => string
  stats: () => { active: number; waiting: number }
}

const realTimer = (fn: () => void, ms: number) => {
  const handle = setTimeout(fn, ms)
  handle.unref?.()
  return { clear: () => clearTimeout(handle) }
}

export const createGate = ({ slots, queue, timeoutMs, setTimer = realTimer }: GateOptions): Gate => {
  let active = 0
  const waiting: { admit: () => void; timer: { clear: () => void } }[] = []

  const releaseOnce = () => {
    let released = false

    return () => {
      if (released) return
      released = true

      const next = waiting.shift()
      if (next === undefined) {
        active -= 1
        return
      }

      next.timer.clear()
      next.admit()
    }
  }

  return {
    stats: () => ({ active, waiting: waiting.length }),

    retryAfter: (reason) => (reason === 'timed-out' ? String(Math.ceil(timeoutMs / 1000)) : '1'),

    enter: async () => {
      if (active < slots) {
        active += 1
        return { ok: true, release: releaseOnce() }
      }

      if (waiting.length >= queue) return { ok: false, reason: 'queue-full' }

      return new Promise<Admission>((resolve) => {
        const entry = {
          admit: () => resolve({ ok: true, release: releaseOnce() }),
          timer: setTimer(() => {
            const index = waiting.indexOf(entry)
            if (index !== -1) waiting.splice(index, 1)
            resolve({ ok: false, reason: 'timed-out' })
          }, timeoutMs),
        }

        waiting.push(entry)
      })
    },
  }
}
