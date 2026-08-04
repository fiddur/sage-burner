import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Loaded } from './load.ts'

import { apiError } from './api/client.ts'
import { errorMessage, useAction, useLoad } from './load.ts'

afterEach(cleanup)

/**
 * The hooks are exercised through a component rather than called directly.
 *
 * `renderHook` would test them in isolation from the thing they exist to fix —
 * effects re-running, a result arriving after unmount, a second click landing while
 * the first is in flight. Those are all render-time behaviours.
 */

const Loader = ({
  fetcher,
  enabled,
}: {
  fetcher: (signal: AbortSignal) => Promise<string>
  enabled?: boolean
}) => {
  const { loaded, reload } = useLoad(fetcher, { enabled, fallback: 'Could not load it.' })

  return (
    <div>
      <span data-testid="state">{describeLoaded(loaded)}</span>
      <button type="button" onClick={reload}>
        Reload
      </button>
    </div>
  )
}

const describeLoaded = (loaded: Loaded<string>) =>
  loaded.status === 'ready' ? loaded.data : loaded.status === 'failed' ? loaded.message : 'loading'

const Actor = ({
  work,
  fallback = 'Could not do it.',
  onSuccess,
}: {
  work: () => Promise<unknown>
  fallback?: string | ((failure: unknown) => string)
  onSuccess?: () => void
}) => {
  const { busy, error, run } = useAction(onSuccess)

  return (
    <div>
      <span data-testid="busy">{busy ? 'busy' : 'idle'}</span>
      <span data-testid="error">{error ?? 'none'}</span>
      <button type="button" onClick={() => run(work, fallback)}>
        Go
      </button>
    </div>
  )
}

const stateText = () => screen.getByTestId('state').textContent

describe('useLoad', () => {
  it('starts loading and hands over the data', async () => {
    render(<Loader fetcher={() => Promise.resolve('the goods')} />)

    expect(stateText()).toBe('loading')
    await waitFor(() => {
      expect(stateText()).toBe('the goods')
    })
  })

  it('keeps the failure message rather than showing an empty page', async () => {
    // One page's own `Loaded` union had dropped the message, so its load failures
    // rendered as nothing at all. That is the drift this hook exists to end.
    render(<Loader fetcher={() => Promise.reject(apiError(500, 'internal', 'Something went wrong.'))} />)

    await waitFor(() => {
      expect(stateText()).toBe('Something went wrong.')
    })
  })

  it('falls back only when the failure carries no message of its own', async () => {
    render(<Loader fetcher={() => Promise.reject(new Error('a stack trace, not for members'))} />)

    await waitFor(() => {
      expect(stateText()).toBe('Could not load it.')
    })
  })

  it('fetches again on reload', async () => {
    let call = 0
    const fetcher = vi.fn(() => Promise.resolve(`call ${++call}`))
    render(<Loader fetcher={fetcher} />)

    await waitFor(() => {
      expect(stateText()).toBe('call 1')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))

    await waitFor(() => {
      expect(stateText()).toBe('call 2')
    })
  })

  it('does not refetch when the caller rebuilds the fetcher on every render', async () => {
    // Callers write `() => api.getThing(signal)` inline, which is a new function
    // each render. Depending on it would refetch in a loop; this is what makes the
    // ref load-bearing rather than tidiness.
    const fetcher = vi.fn(() => Promise.resolve('once'))
    const { rerender } = render(<Loader fetcher={() => fetcher()} />)

    await waitFor(() => {
      expect(stateText()).toBe('once')
    })
    rerender(<Loader fetcher={() => fetcher()} />)
    rerender(<Loader fetcher={() => fetcher()} />)

    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('uses the newest fetcher when it does reload', async () => {
    // The ref must not pin the first one: a page whose fetcher closes over an id
    // would go on asking for the old one after a reload.
    const first = vi.fn(() => Promise.resolve('first'))
    const second = vi.fn(() => Promise.resolve('second'))
    const { rerender } = render(<Loader fetcher={first} />)

    await waitFor(() => {
      expect(stateText()).toBe('first')
    })
    rerender(<Loader fetcher={second} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))

    await waitFor(() => {
      expect(stateText()).toBe('second')
    })
  })

  it('does not fetch at all while it is disabled', async () => {
    const fetcher = vi.fn(() => Promise.resolve('the goods'))
    const { rerender } = render(<Loader fetcher={fetcher} enabled={false} />)

    expect(fetcher).not.toHaveBeenCalled()
    expect(stateText()).toBe('loading')

    // The viewer resolving to a member is exactly this flip.
    rerender(<Loader fetcher={fetcher} enabled />)

    await waitFor(() => {
      expect(stateText()).toBe('the goods')
    })
  })

  it('does not let a superseded request overwrite a newer answer', async () => {
    // The observable half of the abort check. An unmount test proves nothing here —
    // a `setState` on an unmounted Preact component is a silent no-op whether or not
    // the guard is there, so it passes against an implementation with no guard at
    // all. This is the case that actually goes wrong: a slow first request landing
    // after a reload has already been answered, putting stale data back on screen.
    const settlers: ((value: string) => void)[] = []
    render(<Loader fetcher={() => new Promise<string>((resolve) => settlers.push(resolve))} />)

    await waitFor(() => {
      expect(settlers).toHaveLength(1)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    await waitFor(() => {
      expect(settlers).toHaveLength(2)
    })

    settlers[1]?.('the fresh answer')
    await waitFor(() => {
      expect(stateText()).toBe('the fresh answer')
    })

    settlers[0]?.('the stale answer')
    await Promise.resolve()
    await Promise.resolve()

    expect(stateText()).toBe('the fresh answer')
  })

  it('hands the fetcher a signal that fires on unmount', async () => {
    const seen: AbortSignal[] = []
    const { unmount } = render(
      <Loader
        fetcher={(signal) => {
          seen.push(signal)
          return Promise.resolve('the goods')
        }}
      />,
    )

    await waitFor(() => {
      expect(seen).toHaveLength(1)
    })
    expect(seen[0]?.aborted).toBe(false)

    unmount()

    expect(seen[0]?.aborted).toBe(true)
  })
})

describe('useAction', () => {
  it('is busy while the work runs and idle afterwards', async () => {
    let settle: () => void = () => undefined
    render(<Actor work={() => new Promise<void>((resolve) => (settle = resolve))} />)

    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    await waitFor(() => {
      expect(screen.getByTestId('busy').textContent).toBe('busy')
    })

    settle()

    await waitFor(() => {
      expect(screen.getByTestId('busy').textContent).toBe('idle')
    })
  })

  it('refuses a second click while the first is in flight', async () => {
    // True of one of the four copies this replaces and not the others, so a double
    // click on those sent the request twice.
    let settle: () => void = () => undefined
    const work = vi.fn(() => new Promise<void>((resolve) => (settle = resolve)))
    render(<Actor work={work} />)

    const go = screen.getByRole('button', { name: 'Go' })
    fireEvent.click(go)
    await waitFor(() => {
      expect(screen.getByTestId('busy').textContent).toBe('busy')
    })
    fireEvent.click(go)
    fireEvent.click(go)

    expect(work).toHaveBeenCalledTimes(1)

    settle()
    await waitFor(() => {
      expect(screen.getByTestId('busy').textContent).toBe('idle')
    })

    fireEvent.click(go)
    expect(work).toHaveBeenCalledTimes(2)
  })

  it('calls onSuccess only when the work succeeded', async () => {
    const onSuccess = vi.fn()
    const { unmount } = render(<Actor work={() => Promise.resolve()} onSuccess={onSuccess} />)

    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1)
    })
    unmount()

    render(<Actor work={() => Promise.reject(apiError(500, 'internal', 'Nope.'))} onSuccess={onSuccess} />)
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))

    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).toBe('Nope.')
    })
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  it('shows the server’s message, and the fallback only without one', async () => {
    const { unmount } = render(
      <Actor work={() => Promise.reject(apiError(403, 'forbidden', 'Not yours.'))} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).toBe('Not yours.')
    })
    unmount()

    render(<Actor work={() => Promise.reject(new Error('internal detail'))} />)
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))

    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).toBe('Could not do it.')
    })
  })

  it('lets a page map a particular status to particular words', async () => {
    // A 409 on "say you are coming" means the burn is full, which is worth saying
    // rather than "that did not work".
    render(
      <Actor
        work={() => Promise.reject(apiError(409, 'conflict', 'Request failed (409).'))}
        fallback={(failure) =>
          errorMessage(failure, 'x') === 'Request failed (409).' ? 'The burn is full.' : 'Something else.'
        }
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Go' }))

    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).toBe('The burn is full.')
    })
  })

  it('clears the previous error when a new attempt starts', async () => {
    let fail = true
    render(<Actor work={() => (fail ? Promise.reject(new Error('no')) : Promise.resolve())} />)

    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).toBe('Could not do it.')
    })

    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))

    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).toBe('none')
    })
  })
})

describe('errorMessage', () => {
  it('prefers the message the client already mapped for a member', () => {
    expect(errorMessage(apiError(404, 'not_found', 'Not found.'), 'fallback')).toBe('Not found.')
  })

  it('falls back for anything that is not an ApiError', () => {
    expect(errorMessage(new Error('stack trace'), 'fallback')).toBe('fallback')
    expect(errorMessage('a string', 'fallback')).toBe('fallback')
    expect(errorMessage(undefined, 'fallback')).toBe('fallback')
  })
})
