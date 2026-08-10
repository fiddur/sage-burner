import type { AccountRole } from '@sage-burner/shared'
import type { ComponentChildren } from 'preact'

import { createContext } from 'preact'
import { useCallback, useContext, useEffect, useState } from 'preact/hooks'

import type { ApiClient } from './api/client.ts'

export interface Viewer {
  status: 'loading' | 'signed-out' | 'signed-in'
  account?: {
    id: string
    name: string | null
    avatar: string | null
    roles: readonly AccountRole[]
  }
}

export type ViewerAccount = NonNullable<Viewer['account']>

const SIGNED_OUT: Viewer = { status: 'signed-out' }

interface ViewerContextValue {
  viewer: Viewer
  setViewer: (viewer: Viewer) => void
}

const ViewerContext = createContext<ViewerContextValue>({ viewer: SIGNED_OUT, setViewer: () => undefined })

export const ViewerProvider = ({
  children,
  viewer = SIGNED_OUT,
}: {
  children: ComponentChildren
  viewer?: Viewer
}) => {
  const [override, setOverride] = useState<Viewer | undefined>(undefined)

  return (
    <ViewerContext.Provider value={{ viewer: override ?? viewer, setViewer: setOverride }}>
      {children}
    </ViewerContext.Provider>
  )
}

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
                account: {
                  id: response.viewer.account_id,
                  name: response.viewer.name,
                  avatar: response.viewer.avatar,
                  roles: response.viewer.roles,
                },
              },
        )
      })
      .catch(() => {
        if (!controller.signal.aborted) setViewer(SIGNED_OUT)
      })

    return () => {
      controller.abort()
    }
  }, [api])

  return <ViewerContext.Provider value={{ viewer, setViewer }}>{children}</ViewerContext.Provider>
}

export const useViewer = () => useContext(ViewerContext).viewer

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

export const isMember = (viewer: Viewer) => hasRole(viewer, 'member')

export const isApproved = (viewer: Viewer) => isMember(viewer) || isAdmin(viewer)
