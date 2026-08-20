import { DREAM_PARAM, MEAL_PARAM } from '@sage-burner/shared'
import { useLocation } from 'preact-iso'
import { useEffect, useRef } from 'preact/hooks'

import type { Opened } from './components/OpenedDream.tsx'

import { usePhone } from './viewport.ts'

/**
 * Which panel a page has open, kept in the query so Back closes it (#757). Opening pushes and
 * closing replaces: a push on the way out would put the open panel one Back press away again.
 */
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

/**
 * The Schedule's two panels share one query, so closing a dream must keep an open meal in the
 * URL rather than dropping it.
 */
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

/**
 * Both halves read `usePhone()` — this one so the page drops its own content, and the panel so it
 * drops its backdrop. They must agree: disagreeing leaves either a blank page or the grid behind
 * an overlay with no edges.
 */
export const usePanelAsPage = (opened: Opened | undefined, meal?: unknown): boolean =>
  usePhone() && (dreamIdOf(opened) !== undefined || meal !== undefined)
