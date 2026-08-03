import type { AccountRole } from '@sage-burner/shared'
import type { ComponentChildren } from 'preact'

import { createContext } from 'preact'
import { useCallback, useContext, useEffect, useState } from 'preact/hooks'

import type { ApiClient } from './api/client.ts'

/**
 * Who is looking at the page.
 *
 * Named `Viewer` rather than `Session` because `@sage-burner/shared` already
 * exports a `Session` — the member-offered dream — and both will be wanted in
 * the same file once the schedule pages exist. Same reasoning as
 * `nonEmptyText`: avoid the collision rather than alias around it later.
 *
 * `account` carries no email, because `/api/auth/me` deliberately does not
 * return one: the nav renders from `roles` and nothing else, and every extra
 * field here is one more thing already fetched for an XSS to find. A member's
 * own record is a separate authorised read.
 */
export interface Viewer {
  status: 'loading' | 'signed-out' | 'signed-in'
  account?: { id: string; roles: readonly AccountRole[] }
}

export type ViewerAccount = NonNullable<Viewer['account']>

const SIGNED_OUT: Viewer = { status: 'signed-out' }

interface ViewerContextValue {
  viewer: Viewer
  setViewer: (viewer: Viewer) => void
}

const ViewerContext = createContext<ViewerContextValue>({ viewer: SIGNED_OUT, setViewer: () => undefined })

/**
 * A known viewer, for tests and for stories where the answer is already in hand.
 *
 * Stateful rather than a constant so that logging in or out during a test
 * updates the nav the same way it does in the app.
 */
export const ViewerProvider = ({
  children,
  viewer = SIGNED_OUT,
}: {
  children: ComponentChildren
  viewer?: Viewer
}) => {
  // The prop stays live until something actually changes the viewer, rather
  // than being seeded into `useState` and then ignored.
  //
  // The distinction matters because of how it fails: with `useState(viewer)` the
  // prop is an *initial value only*, so a test re-rendering with a different
  // viewer changes nothing and passes against genuinely broken code. A seam whose
  // whole purpose is letting a test say who is looking would silently ignore the
  // second thing it is told.
  //
  // After a login or logout the override wins, because at that point the local
  // answer is the newer one.
  const [override, setOverride] = useState<Viewer | undefined>(undefined)

  return (
    <ViewerContext.Provider value={{ viewer: override ?? viewer, setViewer: setOverride }}>
      {children}
    </ViewerContext.Provider>
  )
}

/**
 * The provider the real app uses: asks the API who is signed in.
 *
 * Split from `ViewerProvider` so tests can mount a known viewer without a
 * fetch, and so this one is exercisable on its own against an injected client.
 *
 * Starts in `loading` rather than `signed-out`. Rendering a signed-out header
 * and swapping it a moment later is the flicker every app of this shape has,
 * and a distinct state is what lets the layout avoid it.
 */
export const FetchedViewerProvider = ({
  children,
  api,
}: {
  children: ComponentChildren
  api: Pick<ApiClient, 'getMe'>
}) => {
  const [viewer, setViewer] = useState<Viewer>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()

    api
      .getMe(controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return

        setViewer(
          response.viewer === null
            ? SIGNED_OUT
            : {
                status: 'signed-in',
                account: { id: response.viewer.account_id, roles: response.viewer.roles },
              },
        )
      })
      .catch(() => {
        // A failed `me` is signed-out as far as the UI is concerned. It is also
        // what an offline first paint looks like, and an error banner on the
        // public homepage for that would be worse than the signed-out nav.
        if (!controller.signal.aborted) setViewer(SIGNED_OUT)
      })

    return () => {
      controller.abort()
    }
  }, [api])

  return <ViewerContext.Provider value={{ viewer, setViewer }}>{children}</ViewerContext.Provider>
}

export const useViewer = () => useContext(ViewerContext).viewer

/** For the login and logout flows, which already know the new viewer. */
export const useSetViewer = () => {
  const { setViewer } = useContext(ViewerContext)

  return useCallback(
    (account: ViewerAccount | null) => {
      setViewer(account === null ? SIGNED_OUT : { status: 'signed-in', account })
    },
    [setViewer],
  )
}

const hasRole = (viewer: Viewer, role: AccountRole) => viewer.account?.roles.includes(role) ?? false

export const isAdmin = (viewer: Viewer) => hasRole(viewer, 'admin')

/**
 * Checks the role rather than merely being signed in.
 *
 * Accounts exist without a membership — an applicant checking on their
 * application is the obvious one — and offering them member pages that then
 * 403 server-side would be worse than not offering them.
 */
export const isMember = (viewer: Viewer) => hasRole(viewer, 'member')

/**
 * Anyone who is in — the mirror of the server's `requireApproved`.
 *
 * `admin` counts, and has to: the roles are independent, so an account can hold
 * `admin` without `member` — an organiser who is not attending. Hiding the page
 * from them would hide the setup from someone allowed to do it.
 */
export const isApproved = (viewer: Viewer) => isMember(viewer) || isAdmin(viewer)
