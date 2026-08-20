import type { ComponentChildren } from 'preact'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { useRef, useState } from 'preact/hooks'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Loaded } from './load.ts'
import type { Remembered } from './remembered.tsx'

import { apiError, isApiError } from './api/client.ts'
import { errorMessage, heldOr, useAction, useLoad, useLoadInto } from './load.ts'
import { createRemembered, RememberedProvider } from './remembered.tsx'

afterEach(cleanup)

const Loader = ({
  fetcher,
  enabled,
  loadKey,
  live,
  remember,
}: {
  fetcher: (signal: AbortSignal) => Promise<string>
  enabled?: boolean
  loadKey?: string
  live?: boolean
  remember?: string
}) => {
  const { loaded, refreshing, reload } = useLoad(fetcher, {
    enabled,
    key: loadKey,
    live,
    remember,
    fallback: 'Could not load it.',
  })

  return (
    <div>
      <span data-testid="state">{describeLoaded(loaded)}</span>
      <span data-testid="refreshing">{refreshing ? 'refreshing' : 'settled'}</span>
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
  onSuccess?: () => void | Promise<void>
}) => {
  const { busy, error, failure, formError, run } = useAction(onSuccess)

  return (
    <div>
      <span data-testid="busy">{busy ? 'busy' : 'idle'}</span>
      <span data-testid="error">{error ?? 'none'}</span>
      <span data-testid="failure">{isApiError(failure) ? String(failure.status) : 'none'}</span>
      <span data-testid="attempt">{formError.attempt}</span>
      <button type="button" onClick={() => run(work, fallback)}>
        Go
      </button>
    </div>
  )
}

const Rows = ({ work }: { work: () => Promise<unknown> }) => {
  const { busy, busyWith, run } = useAction()

  return (
    <div>
      <span data-testid="busy">{busy ? 'busy' : 'idle'}</span>
      <span data-testid="busy-with">{busyWith ?? 'nobody'}</span>
      {['ada', 'bob'].map((who) => (
        <button key={who} type="button" onClick={() => run(work, 'Could not do it.', who)}>
          {who}
        </button>
      ))}
    </div>
  )
}

const Page = ({ fetcher, work }: { fetcher: () => Promise<string>; work: () => Promise<unknown> }) => {
  const { loaded, reload } = useLoad(fetcher, { fallback: 'Could not load it.' })
  const { busy, run } = useAction(reload)

  return (
    <div>
      <span data-testid="state">{describeLoaded(loaded)}</span>
      <span data-testid="busy">{busy ? 'busy' : 'idle'}</span>
      <button type="button" onClick={() => run(work, 'Could not do it.')}>
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
    const fetcher = vi.fn(() => Promise.resolve('once'))
    const { rerender } = render(<Loader fetcher={() => fetcher()} />)

    await waitFor(() => {
      expect(stateText()).toBe('once')
    })
    rerender(<Loader fetcher={() => fetcher()} />)
    rerender(<Loader fetcher={() => fetcher()} />)

    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('refetches when the key changes, which the fetcher itself cannot say', async () => {
    const fetcher = vi.fn(() => Promise.resolve('a burn'))
    const { rerender } = render(<Loader fetcher={() => fetcher()} loadKey="e-1" />)

    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(1)
    })

    rerender(<Loader fetcher={() => fetcher()} loadKey="e-2" />)

    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(2)
    })
  })

  it('does not refetch when the key stays the same', async () => {
    const fetcher = vi.fn(() => Promise.resolve('a burn'))
    const { rerender } = render(<Loader fetcher={() => fetcher()} loadKey="e-1" />)

    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(1)
    })

    rerender(<Loader fetcher={() => fetcher()} loadKey="e-1" />)
    rerender(<Loader fetcher={() => fetcher()} loadKey="e-1" />)

    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('uses the newest fetcher when it does reload', async () => {
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

    rerender(<Loader fetcher={fetcher} enabled />)

    await waitFor(() => {
      expect(stateText()).toBe('the goods')
    })
  })

  it('does not let a superseded request overwrite a newer answer', async () => {
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

describe('coming back to a page', () => {
  const held = (remembered: Remembered, node: ComponentChildren) =>
    render(<RememberedProvider remembered={remembered}>{node}</RememberedProvider>)

  const refreshingText = () => screen.getByTestId('refreshing').textContent

  it('draws last time’s data instead of Loading, and says it is being checked', async () => {
    const remembered = createRemembered()
    let settle: (value: string) => void = () => undefined
    const answer = (value: string) => () => Promise.resolve(value)

    held(remembered, <Loader fetcher={answer('the roster')} remember="members" />)
    await waitFor(() => {
      expect(stateText()).toBe('the roster')
    })
    cleanup()

    held(
      remembered,
      <Loader fetcher={() => new Promise<string>((resolve) => (settle = resolve))} remember="members" />,
    )

    expect(stateText()).toBe('the roster')
    expect(refreshingText()).toBe('refreshing')

    settle('the newer roster')
    await waitFor(() => {
      expect(stateText()).toBe('the newer roster')
    })
    expect(refreshingText()).toBe('settled')
  })

  it('still starts empty for a call site that did not ask to be remembered', async () => {
    const remembered = createRemembered()

    held(remembered, <Loader fetcher={() => Promise.resolve('the roster')} />)
    await waitFor(() => {
      expect(stateText()).toBe('the roster')
    })
    cleanup()

    held(remembered, <Loader fetcher={() => new Promise<string>(() => undefined)} />)

    expect(stateText()).toBe('loading')
  })

  it('keeps one burn’s answer out of another’s', async () => {
    const remembered = createRemembered()
    const answers: Record<string, string> = { 'e-1': 'summer', 'e-2': 'winter' }

    const { rerender } = held(
      remembered,
      <Loader fetcher={() => Promise.resolve(answers['e-1'] ?? '')} loadKey="e-1" remember="schedule" />,
    )
    await waitFor(() => {
      expect(stateText()).toBe('summer')
    })

    rerender(
      <RememberedProvider remembered={remembered}>
        <Loader fetcher={() => new Promise<string>(() => undefined)} loadKey="e-2" remember="schedule" />
      </RememberedProvider>,
    )

    expect(stateText()).toBe('loading')
  })

  it('forgets everything on the way out, since it is member data in memory', async () => {
    const remembered = createRemembered()

    held(remembered, <Loader fetcher={() => Promise.resolve('the roster')} remember="members" />)
    await waitFor(() => {
      expect(stateText()).toBe('the roster')
    })
    cleanup()

    remembered.forget()

    held(remembered, <Loader fetcher={() => new Promise<string>(() => undefined)} remember="members" />)

    expect(stateText()).toBe('loading')
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

  it('stays busy until the re-read it started has landed', async () => {
    let answer: (value: string) => void = () => undefined
    const fetcher = vi.fn(() => new Promise<string>((resolve) => (answer = resolve)))
    render(<Page fetcher={fetcher} work={() => Promise.resolve()} />)

    answer('before')
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('before'))

    fireEvent.click(screen.getByRole('button', { name: 'Go' }))

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    expect(screen.getByTestId('busy').textContent).toBe('busy')

    answer('after')

    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('after'))
    await waitFor(() => expect(screen.getByTestId('busy').textContent).toBe('idle'))
  })

  it('marks the row it actually started, not the one that was refused', async () => {
    let settle: () => void = () => undefined
    render(<Rows work={() => new Promise<void>((resolve) => (settle = resolve))} />)

    fireEvent.click(screen.getByRole('button', { name: 'ada' }))
    await waitFor(() => expect(screen.getByTestId('busy-with').textContent).toBe('ada'))

    fireEvent.click(screen.getByRole('button', { name: 'bob' }))

    expect(screen.getByTestId('busy-with').textContent).toBe('ada')

    settle()
    await waitFor(() => expect(screen.getByTestId('busy-with').textContent).toBe('nobody'))
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

describe('an error a form can focus', () => {
  it('counts every attempt, so a repeated identical failure is still a new one', async () => {
    render(<Actor work={() => Promise.reject(new Error('nope'))} />)

    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    await waitFor(() => expect(screen.getByTestId('error').textContent).toBe('Could not do it.'))
    const first = screen.getByTestId('attempt').textContent

    fireEvent.click(screen.getByRole('button', { name: 'Go' }))

    await waitFor(() => expect(screen.getByTestId('attempt').textContent).not.toBe(first))
    expect(screen.getByTestId('error').textContent).toBe('Could not do it.')
  })

  it('counts a message the page writes itself', async () => {
    const Refusing = () => {
      const { formError, setError } = useAction()

      return (
        <div>
          <span data-testid="attempt">{formError.attempt}</span>
          <span data-testid="error">{formError.message ?? 'none'}</span>
          <button type="button" onClick={() => setError('not filled in')}>
            Complain
          </button>
        </div>
      )
    }
    render(<Refusing />)

    fireEvent.click(screen.getByRole('button', { name: 'Complain' }))
    await waitFor(() => expect(screen.getByTestId('error').textContent).toBe('not filled in'))
    const first = screen.getByTestId('attempt').textContent

    fireEvent.click(screen.getByRole('button', { name: 'Complain' }))

    await waitFor(() => expect(screen.getByTestId('attempt').textContent).not.toBe(first))
  })
})

describe('a page others are changing under you', () => {
  it('refetches when the tab comes back to the front', async () => {
    let answered = 0
    render(<Loader live fetcher={() => Promise.resolve(`load ${(answered += 1)}`)} />)
    await waitFor(() => {
      expect(screen.getByTestId('state').textContent).toBe('load 1')
    })

    fireEvent(window, new Event('focus'))

    await waitFor(() => {
      expect(screen.getByTestId('state').textContent).toBe('load 2')
    })
  })

  it('does not, when it was not asked to', async () => {
    let answered = 0
    render(<Loader fetcher={() => Promise.resolve(`load ${(answered += 1)}`)} />)
    await waitFor(() => {
      expect(screen.getByTestId('state').textContent).toBe('load 1')
    })

    fireEvent(window, new Event('focus'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(screen.getByTestId('state').textContent).toBe('load 1')
  })

  it('keeps what is on screen when a background refresh fails', async () => {
    let online = true
    render(
      <Loader
        live
        fetcher={() => (online ? Promise.resolve('the roster') : Promise.reject(new Error('offline')))}
      />,
    )
    await waitFor(() => {
      expect(screen.getByTestId('state').textContent).toBe('the roster')
    })

    online = false
    fireEvent(window, new Event('focus'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(screen.getByTestId('state').textContent).toBe('the roster')
  })

  it('still reports a failure the member asked for', async () => {
    let online = true
    render(
      <Loader
        live
        fetcher={() => (online ? Promise.resolve('the roster') : Promise.reject(new Error('offline')))}
      />,
    )
    await waitFor(() => {
      expect(screen.getByTestId('state').textContent).toBe('the roster')
    })

    online = false
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))

    await waitFor(() => {
      expect(screen.getByTestId('state').textContent).toBe('Could not load it.')
    })
  })

  it('leaves a hidden tab alone', async () => {
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    try {
      let answered = 0
      render(<Loader live fetcher={() => Promise.resolve(`load ${(answered += 1)}`)} />)
      await waitFor(() => {
        expect(screen.getByTestId('state').textContent).toBe('load 1')
      })

      fireEvent(window, new Event('visibilitychange'))
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(screen.getByTestId('state').textContent).toBe('load 1')
    } finally {
      hidden.mockRestore()
    }
  })
})

describe('a form seeded from what was loaded', () => {
  const Form = ({
    fetcher,
    enabled,
  }: {
    fetcher: (signal: AbortSignal) => Promise<string>
    enabled?: boolean
  }) => {
    const [draft, setDraft] = useState('')
    const seeded = useRef(0)
    const { loaded, reload } = useLoadInto(
      fetcher,
      (value) => {
        seeded.current += 1
        setDraft(value)
      },
      { enabled, fallback: 'Could not load it.' },
    )

    return (
      <div>
        <span data-testid="state">{describeLoaded(loaded)}</span>
        <span data-testid="draft">{draft}</span>
        <span data-testid="seeds">{seeded.current}</span>
        <button type="button" onClick={() => setDraft('typed')}>
          Type
        </button>
        <button type="button" onClick={reload}>
          Reload
        </button>
      </div>
    )
  }

  it('copies the answer into the draft', async () => {
    render(<Form fetcher={() => Promise.resolve('from the server')} />)

    await waitFor(() => expect(screen.getByTestId('draft').textContent).toBe('from the server'))
  })

  it('seeds once per answer, not once per render', async () => {
    render(<Form fetcher={() => Promise.resolve('from the server')} />)
    await waitFor(() => expect(screen.getByTestId('draft').textContent).toBe('from the server'))

    fireEvent.click(screen.getByRole('button', { name: 'Type' }))

    await waitFor(() => expect(screen.getByTestId('draft').textContent).toBe('typed'))
    expect(screen.getByTestId('seeds').textContent).toBe('1')
  })

  it('seeds again after a reload, which is what shows a save landing', async () => {
    let answered = 0
    render(<Form fetcher={() => Promise.resolve(`answer ${(answered += 1)}`)} />)
    await waitFor(() => expect(screen.getByTestId('draft').textContent).toBe('answer 1'))

    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))

    await waitFor(() => expect(screen.getByTestId('draft').textContent).toBe('answer 2'))
  })

  it('seeds nothing from a load that failed', async () => {
    render(<Form fetcher={() => Promise.reject(new Error('nope'))} />)

    await waitFor(() => expect(stateText()).toBe('Could not load it.'))
    expect(screen.getByTestId('draft').textContent).toBe('')
    expect(screen.getByTestId('seeds').textContent).toBe('0')
  })

  it('does not fetch at all when it is not enabled', async () => {
    const fetcher = vi.fn(() => Promise.resolve('from the server'))
    render(<Form fetcher={fetcher} enabled={false} />)

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(fetcher).not.toHaveBeenCalled()
    expect(screen.getByTestId('seeds').textContent).toBe('0')
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

describe('a write refused because somebody else got there first', () => {
  it('re-reads, so "it has been refreshed" is true by the time it is read', async () => {
    const reload = vi.fn()
    render(
      <Actor
        work={() => Promise.reject(apiError(412, 'stale', 'Somebody else changed this.'))}
        onSuccess={reload}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Go' }))

    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).toBe('Somebody else changed this.')
    })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does not re-read for an ordinary failure, which looking again would not fix', async () => {
    const reload = vi.fn()
    render(
      <Actor
        work={() => Promise.reject(apiError(409, 'conflict', 'The burn is full.'))}
        onSuccess={reload}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Go' }))

    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).toBe('The burn is full.')
    })
    expect(reload).not.toHaveBeenCalled()
  })

  it('hands the failure itself over, for the fields that show what the other one says', async () => {
    render(<Actor work={() => Promise.reject(apiError(412, 'stale', 'Changed.'))} />)

    fireEvent.click(screen.getByRole('button', { name: 'Go' }))

    await waitFor(() => {
      expect(screen.getByTestId('failure').textContent).toBe('412')
    })
  })

  it('drops it again when the page writes a message of its own', async () => {
    const Both = () => {
      const { error, failure, setError, run } = useAction()

      return (
        <div>
          <span data-testid="error">{error ?? 'none'}</span>
          <span data-testid="failure">{isApiError(failure) ? String(failure.status) : 'none'}</span>
          <button
            type="button"
            onClick={() => run(() => Promise.reject(apiError(412, 'stale', 'Changed.')), 'x')}
          >
            Go
          </button>
          <button type="button" onClick={() => setError('Give it a name.')}>
            Complain
          </button>
        </div>
      )
    }

    render(<Both />)
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    await waitFor(() => {
      expect(screen.getByTestId('failure').textContent).toBe('412')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Complain' }))

    expect(screen.getByTestId('error').textContent).toBe('Give it a name.')
    expect(screen.getByTestId('failure').textContent).toBe('none')
  })
})

describe('reading what a load is holding', () => {
  it('gives the data once it is ready', () => {
    expect(heldOr({ status: 'ready', data: 'the burn' }, 'nothing')).toBe('the burn')
  })

  it('gives the fallback while it is not, so a hook above the guards has something to read', () => {
    expect(heldOr<string>({ status: 'loading' }, 'nothing')).toBe('nothing')
    expect(heldOr<string>({ status: 'failed', message: 'no' }, 'nothing')).toBe('nothing')
  })
})
