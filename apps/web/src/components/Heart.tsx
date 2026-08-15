import type { Supporter } from '@sage-burner/shared'

import { useId, useRef, useState } from 'preact/hooks'

import { useAway } from '../dropdown.ts'
import { Faces } from './Faces.tsx'

const HOVER_MS = 700

const PRESS_MS = 500

export const Heart = ({
  what,
  hearted,
  count,
  people = [],
  busy,
  onHeart,
}: {
  what: string
  hearted: boolean
  count: number
  people?: readonly Supporter[]
  busy: boolean
  onHeart: (hearting: boolean) => void
}) => {
  const [showing, setShowing] = useState(false)
  const listId = useId()
  const timer = useRef(0)
  const held = useRef(false)
  const wrap = useAway<HTMLSpanElement>(showing, () => setShowing(false))

  const stopWaiting = () => {
    if (timer.current !== 0) clearTimeout(timer.current)
    timer.current = 0
  }

  const waitThenShow = (delay: number, longPress: boolean) => {
    if (people.length === 0) return

    stopWaiting()
    timer.current = window.setTimeout(() => {
      timer.current = 0
      held.current = longPress
      setShowing(true)
    }, delay)
  }

  return (
    <span ref={wrap} class="heart-wrap">
      <button
        type="button"
        class="dream-heart"
        disabled={busy}
        aria-pressed={hearted}
        aria-label={`${hearted ? 'Take back your heart for' : 'Give a heart to'} ${what}`}
        aria-describedby={showing ? listId : undefined}
        onPointerEnter={(pointer) => {
          if (pointer.pointerType === 'touch') return

          waitThenShow(HOVER_MS, false)
        }}
        onPointerLeave={(pointer) => {
          stopWaiting()
          if (pointer.pointerType !== 'touch') setShowing(false)
        }}
        onPointerDown={(pointer) => {
          if (pointer.pointerType !== 'touch') return

          waitThenShow(PRESS_MS, true)
        }}
        onPointerUp={stopWaiting}
        onPointerCancel={stopWaiting}
        onFocus={() => waitThenShow(0, false)}
        onBlur={() => {
          stopWaiting()
          setShowing(false)
        }}
        onClick={(clickEvent) => {
          clickEvent.stopPropagation()
          // A long press asked who else gave one; it is not also a press of the heart.
          if (held.current) {
            held.current = false
            return
          }

          onHeart(!hearted)
        }}
      >
        <span aria-hidden="true">{hearted ? '❤️‍🔥' : '♡'}</span>
        {count > 0 && <span class="dream-heart-count">{count}</span>}
      </button>

      {showing && people.length > 0 && (
        <span id={listId} class="heart-who" role="group" aria-label={`Who gave a heart to ${what}`}>
          <Faces people={people} />
        </span>
      )}
    </span>
  )
}
