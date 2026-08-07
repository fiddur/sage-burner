import { cleanup, render, screen, waitFor } from '@testing-library/preact'
import { LocationProvider, Route, Router, useLocation } from 'preact-iso'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { MessageSource } from './RouteOnMessage.tsx'

import { ROUTE_TO } from '../sw/notification.ts'
import { RouteOnMessage } from './RouteOnMessage.tsx'

afterEach(cleanup)

// `LocationProvider` reads the document's own history, which `cleanup` does not
// touch — so a test that routed leaves the next one starting wherever it finished.
beforeEach(() => {
  globalThis.history.replaceState(null, '', '/')
})

/**
 * A stand-in for `navigator.serviceWorker`, which happy-dom does not provide.
 *
 * An `EventTarget` rather than a spy: the point is that a real `message` event
 * arriving moves the app, so the test dispatches one and looks at the page.
 */
const aWorker = () => {
  const target = new EventTarget()
  // Counted rather than inferred. Dispatching after an unmount proves nothing about
  // the cleanup — `route` on an unmounted tree is a silent no-op, so the test passes
  // against an implementation that never unsubscribes. Measured, not assumed.
  const listening = new Set<(event: MessageEvent) => void>()

  return {
    source: {
      addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => {
        listening.add(listener)
        target.addEventListener(type, listener as EventListener)
      },
      removeEventListener: (type: 'message', listener: (event: MessageEvent) => void) => {
        listening.delete(listener)
        target.removeEventListener(type, listener as EventListener)
      },
    } satisfies MessageSource,
    listening: () => listening.size,
    send: (data: unknown) => {
      target.dispatchEvent(new MessageEvent('message', { data }))
    },
  }
}

const Where = () => <span data-testid="where">{useLocation().path}</span>

const renderApp = (from: MessageSource) =>
  render(
    <LocationProvider>
      <RouteOnMessage from={from} />
      <Router>
        <Route path="/meals" component={() => <p>the meals</p>} />
        <Route default component={() => <p>somewhere else</p>} />
      </Router>
      <Where />
    </LocationProvider>,
  )

describe('being asked to move by the worker', () => {
  it('goes to the page a tapped notification named', async () => {
    // Without this the worker's only options are navigating the window — a full page
    // load, which discards a half-typed markdown field — or opening a second one,
    // which on a phone is a browser tab beside the app rather than the app (#279).
    const worker = aWorker()
    renderApp(worker.source)

    worker.send({ type: ROUTE_TO, path: '/meals' })

    expect(await screen.findByText('the meals')).toBeTruthy()
    expect(screen.getByTestId('where').textContent).toBe('/meals')
  })

  it('stays put for a message that is not the worker asking', async () => {
    // The channel is shared with anything else that ever posts to a page. Moving
    // somebody because a message arrived at all would be worse than not listening.
    const worker = aWorker()
    renderApp(worker.source)

    worker.send({ type: 'something-else', path: '/meals' })
    worker.send('a string')

    await waitFor(() => {
      expect(screen.getByText('somewhere else')).toBeTruthy()
    })
    expect(screen.getByTestId('where').textContent).toBe('/')
  })

  it('stops listening when it goes away, rather than leaving one per mount behind', () => {
    const worker = aWorker()
    const { unmount } = renderApp(worker.source)
    expect(worker.listening()).toBe(1)

    unmount()

    expect(worker.listening()).toBe(0)
  })

  it('does nothing at all where there is no worker to listen to', () => {
    // A browser with workers turned off, and every test that has not asked for this.
    expect(() =>
      render(
        <LocationProvider>
          <RouteOnMessage from={undefined} />
        </LocationProvider>,
      ),
    ).not.toThrow()
  })
})
