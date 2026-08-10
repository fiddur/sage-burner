import type { ComponentChildren } from 'preact'

import { createContext } from 'preact'
import { useContext } from 'preact/hooks'

export interface Remembered {
  read: <T>(at: string) => T | undefined
  write: (at: string, data: unknown) => void
  forget: () => void
}

export const createRemembered = (): Remembered => {
  const held = new Map<string, unknown>()

  return {
    read: <T,>(at: string) => held.get(at) as T | undefined,
    write: (at, data) => {
      held.set(at, data)
    },
    forget: () => {
      held.clear()
    },
  }
}

const REMEMBERS_NOTHING: Remembered = {
  read: () => undefined,
  write: () => undefined,
  forget: () => undefined,
}

const RememberedContext = createContext<Remembered>(REMEMBERS_NOTHING)

export const RememberedProvider = ({
  children,
  remembered,
}: {
  children: ComponentChildren
  remembered: Remembered
}) => <RememberedContext.Provider value={remembered}>{children}</RememberedContext.Provider>

export const useRemembered = () => useContext(RememberedContext)
