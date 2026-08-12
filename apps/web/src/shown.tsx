import type { NotificationsResponse } from '@sage-burner/shared'
import type { ComponentChildren } from 'preact'

import { createContext } from 'preact'
import { useContext } from 'preact/hooks'

import type { ApiClient } from './api/client.ts'

export interface Shown {
  report: (link: string, signal: AbortSignal) => void
  subscribe: (listener: (seen: NotificationsResponse) => void) => () => void
}

export type ShownApi = Pick<ApiClient, 'markTargetShown' | 'readAt'>

export const createShown = (api: ShownApi): Shown => {
  const listeners = new Set<(seen: NotificationsResponse) => void>()
  const reported = new Map<string, string>()

  return {
    report: (link, signal) => {
      const asOf = api.readAt(signal)
      if (asOf === undefined || link === '') return

      const held = reported.get(link)
      if (held !== undefined && asOf <= held) return

      reported.set(link, asOf)

      void api
        .markTargetShown({ link, as_of: asOf })
        .then((seen) => {
          for (const listener of listeners) listener(seen)
        })
        .catch(() => {
          reported.delete(link)
        })
    },

    subscribe: (listener) => {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
  }
}

const SHOWS_NOTHING: Shown = {
  report: () => undefined,
  subscribe: () => () => undefined,
}

const ShownContext = createContext<Shown>(SHOWS_NOTHING)

export const ShownProvider = ({ children, shown }: { children: ComponentChildren; shown: Shown }) => (
  <ShownContext.Provider value={shown}>{children}</ShownContext.Provider>
)

export const useShown = () => useContext(ShownContext)
