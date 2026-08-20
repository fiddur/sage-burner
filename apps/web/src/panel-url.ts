import { DREAM_PARAM, MEAL_PARAM } from '@sage-burner/shared'
import { useLocation } from 'preact-iso'
import { useEffect, useRef } from 'preact/hooks'

import type { Opened } from './components/OpenedDream.tsx'

import { usePhone } from './viewport.ts'

export const useOpenedInUrl = (
  param: string,
  pathFor: (id: string | undefined) => string | undefined,
  onAsked: (id: string | undefined) => void,
): ((id: string | undefined) => void) => {
  const { query, route } = useLocation()
  const asked: string | undefined = query?.[param]

  const latest = useRef(onAsked)
  latest.current = onAsked

  useEffect(() => {
    latest.current(asked)
  }, [asked])

  return (id: string | undefined) => {
    if (id === asked) return

    const to = pathFor(id)
    if (to !== undefined) route(to, id === undefined)
  }
}

export const openedFrom = (held: Opened | undefined, asked: string | undefined): Opened | undefined => {
  if (asked === undefined) return held?.kind === 'dream' ? undefined : held
  if (held?.kind === 'dream' && held.id === asked) return held

  return { kind: 'dream', id: asked, editing: false }
}

export const usePanelsInUrl = (
  pathFor: (open: { dream?: string; meal?: string }) => string | undefined,
  openedMeal: string | undefined,
  onDream: (asked: string | undefined) => void,
  onMeal: (asked: string | undefined) => void,
) => ({
  showDreamInUrl: useOpenedInUrl(
    DREAM_PARAM,
    (id) => pathFor(id === undefined ? { meal: openedMeal } : { dream: id }),
    onDream,
  ),
  showMealInUrl: useOpenedInUrl(MEAL_PARAM, (id) => pathFor(id === undefined ? {} : { meal: id }), onMeal),
})

export const dreamIdOf = (opened: Opened | undefined): string | undefined =>
  opened?.kind === 'dream' ? opened.id : undefined

export const usePanelAsPage = (showing: boolean): boolean => usePhone() && showing

export const panelIsShowing = (
  dreams: readonly { id: string }[],
  opened: Opened | undefined,
  meal?: { id: string },
): boolean => {
  const wanted = dreamIdOf(opened)

  return meal !== undefined || dreams.some((dream) => dream.id === wanted)
}

export const heldOr = <T>(loaded: { status: string; data?: T }, fallback: T): T =>
  loaded.status === 'ready' && loaded.data !== undefined ? loaded.data : fallback
