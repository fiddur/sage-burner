import { useLocation } from 'preact-iso'
import { useEffect } from 'preact/hooks'

import { routeAsked } from '../worker-message.ts'

export interface MessageSource {
  addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void
  removeEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void
}

export const RouteOnMessage = ({
  from = globalThis.navigator?.serviceWorker ?? null,
}: {
  from?: MessageSource | null
}) => {
  const { route } = useLocation()

  useEffect(() => {
    if (from === null) return undefined

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
