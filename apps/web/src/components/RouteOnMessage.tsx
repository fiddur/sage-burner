import { useLocation } from 'preact-iso'
import { useEffect } from 'preact/hooks'

import { routeAsked } from '../sw/notification.ts'

/**
 * Enough of the worker's side of the channel to be handed a fake.
 *
 * Narrow in the same spirit as `push.ts`'s `PushBrowser` and `offline.ts`'s
 * `WorkerRegistrar`: a test supplies an `EventTarget` rather than building a
 * `ServiceWorkerContainer` it never looks at.
 */
export interface MessageSource {
  addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void
  removeEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void
}

/**
 * Taking a tapped notification to its page without reloading (#279).
 *
 * The worker focuses the window that is already open and asks it to go somewhere
 * rather than navigating it, because `client.navigate()` is a full page load and
 * would throw away whatever was half-typed into a markdown editor. This is the half
 * that listens.
 *
 * Renders nothing and lives inside `LocationProvider`, which is where `route` comes
 * from. Doing nothing at all is the honest failure: a window loaded before this
 * shipped has no listener, so it stays where it is — inside the app, on the wrong
 * page, which is the better half of the trade the worker already made.
 */
export const RouteOnMessage = ({ from = globalThis.navigator?.serviceWorker }: { from?: MessageSource }) => {
  const { route } = useLocation()

  useEffect(() => {
    // Absent in a browser with workers turned off, and in a test that has not asked
    // for this. Neither is a failure: nothing is listening because nothing sends.
    if (from === undefined) return undefined

    const onMessage = (event: MessageEvent) => {
      const path = routeAsked(event.data)
      if (path !== undefined) route(path)
    }

    from.addEventListener('message', onMessage)

    return () => {
      from.removeEventListener('message', onMessage)
    }
  }, [from, route])

  return null
}
