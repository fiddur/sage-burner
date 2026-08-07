import type { ComponentChildren } from 'preact'

import { useState } from 'preact/hooks'

import { moveTo, swap } from '../reorder.ts'

/**
 * A list somebody can put in order (#146).
 *
 * Four pages let you rearrange one — the schedule's lanes, a burn's lodging and
 * helping options, the allergy vocabulary and the FAQ — and each had written out its
 * own: the drop target, the `⠿` handle with its `dataTransfer` workaround, the drag
 * state, the arrow-key fallback. Thirty-odd lines, and the affordances are exactly
 * what goes missing when they are re-derived — the allergy list grew ↑/↓ buttons and
 * no drag, `QuestionEditor` the same, and the other three drag and nothing else.
 *
 * **All three affordances, on every list.** Dragging for a mouse; the arrow keys on
 * the handle for a keyboard; and ↑/↓ buttons, which are the only one of the three
 * that works on a phone — HTML5 drag-and-drop does not fire for touch at all, so the
 * lists that had a handle alone could not be reordered on the device half of this is
 * read on.
 *
 * The **rows** are the caller's — four different shapes, and only their order is
 * shared — so this owns the skeleton and takes the body as a function. Deliberately
 * not a generic editable list: the field bodies genuinely differ, which is the line
 * #147 draws.
 *
 * `onReorder` is called only when there is a move to make. `swap` and `moveTo` answer
 * `undefined` at the ends, and sending an unchanged order is a wasted round trip that
 * every reorder endpoint would accept.
 */
export const ReorderableList = <Row extends { id: string }>({
  rows,
  busy,
  labelFor,
  onReorder,
  rowClass,
  children,
}: {
  rows: readonly Row[]
  busy: boolean
  /** What this row is, for the three controls' labels. */
  labelFor: (row: Row) => string
  onReorder: (ids: string[]) => void
  /** Added to every row, for a list that needs a shape of its own. */
  rowClass?: string
  children: (row: Row, index: number) => ComponentChildren
}) => {
  const [dragging, setDragging] = useState<number | undefined>(undefined)

  const ids = rows.map((row) => row.id)
  const move = (wanted: string[] | undefined) => {
    if (wanted !== undefined) onReorder(wanted)
  }

  return (
    <ol class="reorder-list">
      {rows.map((row, index) => (
        <li
          key={row.id}
          class={['reorder-row', rowClass, dragging === index ? 'is-dragging' : undefined]
            .filter((one) => one !== undefined)
            .join(' ')}
          onDragOver={(dragEvent) => {
            // Without this the drop never fires — the default is "not a drop target".
            dragEvent.preventDefault()
          }}
          onDrop={(dropEvent) => {
            dropEvent.preventDefault()
            if (dragging !== undefined) move(moveTo(ids, dragging, index))
            setDragging(undefined)
          }}
        >
          <span class="reorder-controls">
            <button
              type="button"
              class="drag-handle"
              draggable={!busy}
              disabled={busy}
              aria-label={`Move ${labelFor(row)}`}
              onDragStart={(dragEvent) => {
                // Firefox will not start a drag whose data store is empty.
                dragEvent.dataTransfer?.setData('text/plain', row.id)
                setDragging(index)
              }}
              onDragEnd={() => setDragging(undefined)}
              onKeyDown={(keyEvent) => {
                const by = keyEvent.key === 'ArrowUp' ? -1 : keyEvent.key === 'ArrowDown' ? 1 : undefined
                if (by === undefined) return
                keyEvent.preventDefault()
                move(swap(ids, index, by))
              }}
            >
              ⠿
            </button>

            {/* Disabled at the ends as well as guarded by `swap`, so the control says
                what it will do rather than doing nothing when pressed. */}
            <button
              type="button"
              class="link-button"
              aria-label={`Move ${labelFor(row)} up`}
              disabled={busy || index === 0}
              onClick={() => move(swap(ids, index, -1))}
            >
              ↑
            </button>
            <button
              type="button"
              class="link-button"
              aria-label={`Move ${labelFor(row)} down`}
              disabled={busy || index === rows.length - 1}
              onClick={() => move(swap(ids, index, 1))}
            >
              ↓
            </button>
          </span>

          {children(row, index)}
        </li>
      ))}
    </ol>
  )
}
