import type { ComponentChildren } from 'preact'

import { createContext } from 'preact'
import { useContext } from 'preact/hooks'

/**
 * Who is looking at the page.
 *
 * There is no auth yet (#8), so this always resolves to signed-out. It exists
 * now so the layout and nav are built against the real shape rather than
 * hardcoding a logged-out header that has to be unpicked later — and so the
 * places that will need a role check are visible from the start.
 */
export interface Session {
  status: 'loading' | 'signed-out' | 'signed-in'
  /** Undefined until #8; `roles` decides what the nav offers. */
  account?: { id: string; email: string; roles: readonly ('admin' | 'member')[] }
}

const SIGNED_OUT: Session = { status: 'signed-out' }

const SessionContext = createContext<Session>(SIGNED_OUT)

export const SessionProvider = ({
  children,
  session = SIGNED_OUT,
}: {
  children: ComponentChildren
  session?: Session
}) => <SessionContext.Provider value={session}>{children}</SessionContext.Provider>

export const useSession = () => useContext(SessionContext)

export const isAdmin = (session: Session) => session.account?.roles.includes('admin') ?? false
export const isMember = (session: Session) => session.status === 'signed-in'
