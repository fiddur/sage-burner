import type { MyBurn } from '@sage-burner/shared'
import type { ComponentChildren } from 'preact'

import { createContext } from 'preact'
import { useCallback, useContext, useEffect, useState } from 'preact/hooks'

import type { ApiClient } from './api/client.ts'

import { isAdmin, isApproved, useViewer } from './viewer.tsx'

/**
 * Which burn every burn-scoped page is about.
 *
 * More than one is planned at a time, so "the active burn" stopped being a rule the
 * app could apply on the reader's behalf (#184). The selector in the bar is where
 * that choice is made, and this is what it is made in — one fetch for the whole
 * session rather than one `getActiveEvent` per page, which is what the pages did
 * before and why each of them had its own opinion about what "current" meant.
 *
 * The API takes an event id on every burn-scoped route now, so nothing here is
 * access control: a member who edits the id in the selector reaches routes that
 * check for themselves, and a burn that has ended refuses every write regardless.
 */

export interface BurnChoice {
  status: 'loading' | 'ready'
  /** Every burn this viewer may look at, soonest first. */
  burns: readonly MyBurn[]
  /** The one the pages are about, or nothing when there is none to be about. */
  selected: MyBurn | undefined
}

interface BurnContextValue extends BurnChoice {
  select: (eventId: string) => void
}

const EMPTY: BurnContextValue = {
  status: 'loading',
  burns: [],
  selected: undefined,
  select: () => undefined,
}

const BurnContext = createContext<BurnContextValue>(EMPTY)

/**
 * Which burns a viewer may choose between.
 *
 * A member sees the ones they have said they are coming to: the bar is for the burn
 * they are part of, and the rest are on their details page to join. **An admin sees
 * every burn still to come**, because an organiser holding `admin` without `member`
 * has no attendance anywhere and would otherwise face an empty selector on the burn
 * they are setting up.
 */
export const choosableBurns = (admin: boolean, coming: readonly MyBurn[]): readonly MyBurn[] =>
  admin ? coming : coming.filter((burn) => burn.attendance !== null)

/** A known choice, for tests and for pages rendered outside the app shell. */
export const BurnProvider = ({
  children,
  value = EMPTY,
}: {
  children: ComponentChildren
  value?: Omit<BurnContextValue, 'select'> & Partial<Pick<BurnContextValue, 'select'>>
}) => <BurnContext.Provider value={{ select: () => undefined, ...value }}>{children}</BurnContext.Provider>

/**
 * The choice, fetched once and held for the session.
 *
 * Not persisted anywhere. A reload landing on the soonest burn the viewer is part of
 * is the right default every time, and a remembered choice would leave somebody
 * looking at last month's grid without being able to say why.
 */
export const FetchedBurnProvider = ({
  api,
  children,
}: {
  api: Pick<ApiClient, 'getMyBurns'>
  children: ComponentChildren
}) => {
  const viewer = useViewer()
  // Booleans rather than the viewer object, which the provider hands out fresh on
  // every render — depending on it would refetch continuously.
  const approved = isApproved(viewer)
  const admin = isAdmin(viewer)
  const [burns, setBurns] = useState<readonly MyBurn[]>([])
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')
  const [chosen, setChosen] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (!approved) {
      // Signed out, or an applicant waiting on a decision. Ready with nothing, so a
      // page renders its own explanation rather than "one moment…" forever.
      setStatus('ready')
      setBurns([])
      return undefined
    }

    const controller = new AbortController()

    api
      .getMyBurns(controller.signal)
      .then(({ coming }) => {
        if (controller.signal.aborted) return
        setBurns(choosableBurns(admin, coming))
        setStatus('ready')
      })
      .catch(() => {
        // The pages each report their own failure to load; an empty selector is the
        // honest thing for the bar to show meanwhile.
        if (!controller.signal.aborted) setStatus('ready')
      })

    return () => controller.abort()
  }, [api, approved, admin])

  const select = useCallback((eventId: string) => setChosen(eventId), [])
  const selected = burns.find((burn) => burn.event.id === chosen) ?? burns[0]

  return <BurnContext.Provider value={{ status, burns, selected, select }}>{children}</BurnContext.Provider>
}

export const useBurns = (): BurnContextValue => useContext(BurnContext)

/** The burn the page is about, or nothing while it is still being decided. */
export const useSelectedBurn = (): MyBurn | undefined => useContext(BurnContext).selected
