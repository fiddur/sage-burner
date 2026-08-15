import { useState } from 'preact/hooks'

export const SIDEBAR_HIDDEN_KEY = 'sage-burner:sidebar-hidden'

export const sidebarHidden = (store?: Storage): boolean => {
  try {
    const held = store ?? globalThis.localStorage

    return typeof held?.getItem(SIDEBAR_HIDDEN_KEY) === 'string'
  } catch {
    return false
  }
}

export const rememberSidebar = (hidden: boolean, store?: Storage): void => {
  try {
    const held = store ?? globalThis.localStorage

    if (hidden) held?.setItem(SIDEBAR_HIDDEN_KEY, 'yes')
    else held?.removeItem(SIDEBAR_HIDDEN_KEY)
  } catch {}
}

export interface SidebarState {
  hidden: boolean
  hide: () => void
  show: () => void
}

// Read before the first paint rather than in an effect: an effect would draw the sidebar
// and take it away again on every load for whoever has hidden it.
export const useSidebar = (): SidebarState => {
  const [hidden, setHidden] = useState(() => sidebarHidden())

  const settle = (wanted: boolean) => {
    setHidden(wanted)
    rememberSidebar(wanted)
  }

  return { hidden, hide: () => settle(true), show: () => settle(false) }
}
