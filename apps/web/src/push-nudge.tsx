import type { ComponentChildren } from 'preact'

import { createContext } from 'preact'
import { useContext, useMemo, useState } from 'preact/hooks'

import { dismissedPushNudge, dismissPushNudge } from './push.ts'
import { useViewer } from './viewer.tsx'

export interface PushNudging {
  wanted: boolean
  askAbout: () => void
  dismiss: () => void
}

const PushNudgeContext = createContext<PushNudging>({
  wanted: false,
  askAbout: () => undefined,
  dismiss: () => undefined,
})

export const PushNudgeProvider = ({ children, store }: { children: ComponentChildren; store?: Storage }) => {
  const [asked, setAsked] = useState(false)
  const [dropped, setDropped] = useState(() => dismissedPushNudge(store))
  const signedIn = useViewer().status === 'signed-in'

  const value = useMemo(
    () => ({
      wanted: signedIn && asked && !dropped,
      askAbout: () => setAsked(true),
      dismiss: () => {
        dismissPushNudge(store)
        setDropped(true)
      },
    }),
    [asked, dropped, signedIn, store],
  )

  return <PushNudgeContext.Provider value={value}>{children}</PushNudgeContext.Provider>
}

export const usePushNudge = (): PushNudging => useContext(PushNudgeContext)
