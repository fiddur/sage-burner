import { cleanup, render, screen, waitFor } from '@testing-library/preact'
import { LocationProvider, Route, Router, useLocation } from 'preact-iso'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { MessageSource } from './RouteOnMessage.tsx'

import { ROUTE_TO } from '../worker-message.ts'
import { RouteOnMessage } from './RouteOnMessage.tsx'

afterEach(cleanup)

beforeEach(() => {
  globalThis.history.replaceState(null, '', '/')
})

const aWorker = () => {
  const target = new EventTarget()
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
    const worker = aWorker()
    renderApp(worker.source)

    worker.send({ type: ROUTE_TO, path: '/meals' })

    expect(await screen.findByText('the meals')).toBeTruthy()
    expect(screen.getByTestId('where').textContent).toBe('/meals')
  })

  it('stays put for a message that is not the worker asking', async () => {
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
    expect(() =>
      render(
        <LocationProvider>
          <RouteOnMessage from={null} />
        </LocationProvider>,
      ),
    ).not.toThrow()
  })
})
