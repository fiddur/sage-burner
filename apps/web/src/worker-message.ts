/**
 * The one thing the service worker says to a page, and how a page reads it (#295).
 *
 * Both halves of a contract between two bundles, so it belongs to neither. It lived
 * in `sw/notification.ts`, which meant the page bundle imported out of the worker's
 * directory to hear the worker — harmless, since nothing there runs at module scope,
 * but it read as though the page were part of the worker.
 */

/**
 * What the worker asks an open window to do when a notification names a page it is
 * not showing.
 *
 * A message rather than `client.navigate()`, which is a full page load and would
 * discard whatever somebody had typed into a markdown editor — the thing the dream
 * panel was rewritten to stop doing. The app routes it in place instead.
 */
export const ROUTE_TO = 'sage-burner:route-to'

/** The path an open window is being asked to show, if that is what a message is. */
export const routeAsked = (data: unknown): string | undefined => {
  if (typeof data !== 'object' || data === null) return undefined
  if (Reflect.get(data, 'type') !== ROUTE_TO) return undefined

  const path = Reflect.get(data, 'path')

  return typeof path === 'string' ? path : undefined
}
