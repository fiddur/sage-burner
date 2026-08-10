import { useLocation } from 'preact-iso'
import { useEffect, useRef, useState } from 'preact/hooks'

export const PHONE = '(max-width: 45rem)'

export const usePhone = (): boolean => {
  const [phone, setPhone] = useState(() => globalThis.matchMedia?.(PHONE).matches === true)

  useEffect(() => {
    const query = globalThis.matchMedia?.(PHONE)
    if (query === undefined) return undefined

    const answer = (change: MediaQueryListEvent) => setPhone(change.matches)
    setPhone(query.matches)
    query.addEventListener('change', answer)

    return () => query.removeEventListener('change', answer)
  }, [])

  return phone
}

const THRESHOLD = 24

const REST = 48

export interface BarScroll {
  hidden: boolean
  from: number
}

export const AT_REST: BarScroll = { hidden: false, from: 0 }

export const nearTheEnd = (at: number, viewport: number, page: number): boolean =>
  at + viewport >= page - REST

export const scrolledTo = (state: BarScroll, at: number, nearEnd: boolean): BarScroll => {
  if (at <= REST) return AT_REST

  if (nearEnd) return { ...state, from: at }

  const moved = at - state.from

  if (moved > THRESHOLD) return { hidden: true, from: at }
  if (moved < -THRESHOLD) return { hidden: false, from: at }

  if (state.hidden === at > state.from) return { ...state, from: at }

  return state
}

export const useHidingBar = (enabled: boolean): boolean => {
  const [hidden, setHidden] = useState(false)
  const state = useRef<BarScroll>(AT_REST)
  const { path } = useLocation()

  useEffect(() => {
    state.current = AT_REST
    setHidden(false)

    if (!enabled) return undefined

    let frame = 0

    const measure = () => {
      frame = 0
      const at = globalThis.scrollY

      state.current = scrolledTo(
        state.current,
        at,
        nearTheEnd(at, globalThis.innerHeight, document.documentElement.scrollHeight),
      )
      setHidden(state.current.hidden)
    }

    const onScroll = () => {
      if (frame !== 0) return
      frame = requestAnimationFrame(measure)
    }

    globalThis.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      globalThis.removeEventListener('scroll', onScroll)
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [enabled, path])

  return hidden
}
