import type { MyBurn } from '@sage-burner/shared'
import type { ComponentChildren } from 'preact'

import { createContext } from 'preact'
import { useLocation } from 'preact-iso'
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
  /**
   * `failed` is separate from `ready` with nothing, because the two mean opposite
   * things to a reader: one is a fact about them, the other is a fact about the
   * request. Collapsed together, a dropped connection told a member "you are not
   * coming to a burn yet" (#193).
   */
  status: 'loading' | 'ready' | 'failed'
  /** Every burn this viewer may look at, soonest first. */
  burns: readonly MyBurn[]
  /** The one the pages are about, or nothing when there is none to be about. */
  selected: MyBurn | undefined
}

interface BurnContextValue extends BurnChoice {
  select: (eventId: string) => void
  /**
   * Ask for the list again.
   *
   * Joining a burn changes what this holds, and nothing else on the page knows that:
   * a member who joined and then opened Members or Schedule was told they were not
   * coming to a burn until they reloaded, because the fetch happens once for the
   * session. Whoever writes the change says so here.
   */
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

/**
 * Which burns a viewer may choose between.
 *
 * A member sees the ones they have said they are coming to: the bar is for the burn
 * they are part of, and the rest are on their details page to join. **An admin sees
 * every burn still to come**, because an account holding `admin` without `member`
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
  value?: Omit<BurnContextValue, 'reload' | 'select'> & Partial<Pick<BurnContextValue, 'reload' | 'select'>>
}) => (
  <BurnContext.Provider value={{ select: () => undefined, reload: () => undefined, ...value }}>
    {children}
  </BurnContext.Provider>
)

/**
 * The query parameter a link uses to say which burn it is about (#333).
 *
 * Read here rather than by each page, which is what makes one line's link land right
 * on all of them: every burn-scoped page reads the selector, so the selector following
 * the URL is the whole of it. The feed is what needed it — it spans burns, so a line
 * about the autumn burn followed while the selector sat on the summer one opened the
 * wrong page entirely.
 */
export const BURN_PARAM = 'burn'

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
  const [status, setStatus] = useState<BurnChoice['status']>('loading')
  const [chosen, setChosen] = useState<string | undefined>(undefined)
  const [attempt, setAttempt] = useState(0)
  // `?.` because `useLocation` outside a `LocationProvider` answers the context's
  // default — an empty object cast to the hook's type, so `query` is typed as present
  // and is not. Every page has one; a test rendering this provider bare does not.
  const asked: string | undefined = useLocation().query?.[BURN_PARAM]

  // A link that names a burn chooses it, and a later one chooses again. Keyed on the
  // parameter rather than folded into `selected`, so the bar's own selector still wins
  // afterwards — following a link is a choice, not a lock.
  useEffect(() => {
    if (asked !== undefined) setChosen(asked)
  }, [asked])

  useEffect(() => {
    if (!approved) {
      // Signed out, or an applicant waiting on a decision. Ready with nothing, so a
      // page renders its own explanation rather than "one moment…" forever.
      setStatus('ready')
      setBurns([])
      return undefined
    }

    const controller = new AbortController()

    // A retry is an attempt in progress, and says so. Without this the "could not
    // load your burns" copy stays on screen for the whole of the second try, so the
    // button appears to do nothing until it either succeeds or fails again (#236).
    setStatus('loading')

    api
      .getMyBurns(controller.signal)
      .then(({ coming }) => {
        if (controller.signal.aborted) return
        setBurns(choosableBurns(admin, coming))
        setStatus('ready')
      })
      .catch(() => {
        // Not `ready` with nothing: the selector is empty either way, but a page
        // reading this has to be able to tell "you have joined none" from "we could
        // not ask".
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

/** The burn the page is about, or nothing while it is still being decided. */
export const useSelectedBurn = (): MyBurn | undefined => useContext(BurnContext).selected
