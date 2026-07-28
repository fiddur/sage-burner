import type { AccountRole } from '@sage-burner/shared'
import type { ComponentChildren } from 'preact'

import { createContext } from 'preact'
import { useContext } from 'preact/hooks'

/**
 * Who is looking at the page.
 *
 * Named `Viewer` rather than `Session` because `@sage-burner/shared` already
 * exports a `Session` — the member-offered dream — and both will be wanted in
 * the same file once the schedule pages exist. Same reasoning as
 * `nonEmptyText`: avoid the collision rather than alias around it later.
 *
 * There is no auth yet (#8), so this always resolves to signed-out. It exists
 * now so the layout and nav are built against the real shape rather than a
 * hardcoded logged-out header that has to be unpicked later.
 */
export interface Viewer {
  status: 'loading' | 'signed-out' | 'signed-in'
  /** Undefined until #8; `roles` decides what the nav offers. */
  account?: { id: string; email: string; roles: readonly AccountRole[] }
}

const SIGNED_OUT: Viewer = { status: 'signed-out' }

const ViewerContext = createContext<Viewer>(SIGNED_OUT)

export const ViewerProvider = ({
  children,
  viewer = SIGNED_OUT,
}: {
  children: ComponentChildren
  viewer?: Viewer
}) => <ViewerContext.Provider value={viewer}>{children}</ViewerContext.Provider>

export const useViewer = () => useContext(ViewerContext)

const hasRole = (viewer: Viewer, role: AccountRole) => viewer.account?.roles.includes(role) ?? false

export const isAdmin = (viewer: Viewer) => hasRole(viewer, 'admin')

/**
 * Checks the role rather than merely being signed in.
 *
 * #8 brings accounts that exist without a membership — an applicant checking on
 * their application is the obvious one — and offering them member pages that
 * then 403 server-side would be worse than not offering them.
 */
export const isMember = (viewer: Viewer) => hasRole(viewer, 'member')
