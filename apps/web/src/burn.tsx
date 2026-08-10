import type { MyBurn } from '@sage-burner/shared'
import type { ComponentChildren } from 'preact'

import { BURN_PARAM } from '@sage-burner/shared'
import { createContext } from 'preact'
import { useLocation } from 'preact-iso'
import { useCallback, useContext, useEffect, useState } from 'preact/hooks'

import type { ApiClient } from './api/client.ts'

import { isAdmin, isApproved, useViewer } from './viewer.tsx'

export interface BurnChoice {
  status: 'loading' | 'ready' | 'failed'
  burns: readonly MyBurn[]
  selected: MyBurn | undefined
}

interface BurnContextValue extends BurnChoice {
  select: (eventId: string) => void
  reload: () => void
}

const EMPTY: BurnContextValue = {
  status: 'loading',
  burns: [],
  selected: undefined,
  select: () => undefined,
  reload: () => undefined,
}

const BurnContext = createContext<BurnContextValue>(EMPTY)

export const choosableBurns = (admin: boolean, coming: readonly MyBurn[]): readonly MyBurn[] =>
  admin ? coming : coming.filter((burn) => burn.attendance !== null)

export const BurnProvider = ({
  children,
  value = EMPTY,
}: {
  children: ComponentChildren
  value?: Omit<BurnContextValue, 'reload' | 'select'> & Partial<Pick<BurnContextValue, 'reload' | 'select'>>
}) => (
  <BurnContext.Provider value={{ select: () => undefined, reload: () => undefined, ...value }}>
    {children}
  </BurnContext.Provider>
)

export { BURN_PARAM }

export const FetchedBurnProvider = ({
  api,
  children,
}: {
  api: Pick<ApiClient, 'getMyBurns'>
  children: ComponentChildren
}) => {
  const viewer = useViewer()
  const approved = isApproved(viewer)
  const admin = isAdmin(viewer)
  const [burns, setBurns] = useState<readonly MyBurn[]>([])
  const [status, setStatus] = useState<BurnChoice['status']>('loading')
  const [chosen, setChosen] = useState<string | undefined>(undefined)
  const [attempt, setAttempt] = useState(0)
  const asked: string | undefined = useLocation().query?.[BURN_PARAM]

  useEffect(() => {
    if (asked !== undefined) setChosen(asked)
  }, [asked])

  useEffect(() => {
    if (!approved) {
      setStatus('ready')
      setBurns([])
      return undefined
    }

    const controller = new AbortController()

    setStatus('loading')

    api
      .getMyBurns(controller.signal)
      .then(({ coming }) => {
        if (controller.signal.aborted) return
        setBurns(choosableBurns(admin, coming))
        setStatus('ready')
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('failed')
      })

    return () => controller.abort()
  }, [api, approved, admin, attempt])

  const select = useCallback((eventId: string) => setChosen(eventId), [])
  const reload = useCallback(() => setAttempt((before) => before + 1), [])
  const selected = burns.find((burn) => burn.event.id === chosen) ?? burns[0]

  return (
    <BurnContext.Provider value={{ status, burns, selected, select, reload }}>
      {children}
    </BurnContext.Provider>
  )
}

export const useBurns = (): BurnContextValue => useContext(BurnContext)

export const useSelectedBurn = (): MyBurn | undefined => useContext(BurnContext).selected
