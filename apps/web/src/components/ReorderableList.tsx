import type { ComponentChildren } from 'preact'

import { useState } from 'preact/hooks'

import { moveTo, swap } from '../reorder.ts'
import { Icon } from './Icon.tsx'
import { IconButton } from './IconButton.tsx'

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
  labelFor: (row: Row) => string
  onReorder: (ids: string[]) => void
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
              <Icon name="drag" />
            </button>

            <IconButton
              icon="up"
              label={`Move ${labelFor(row)} up`}
              disabled={busy || index === 0}
              onClick={() => move(swap(ids, index, -1))}
            />
            <IconButton
              icon="down"
              label={`Move ${labelFor(row)} down`}
              disabled={busy || index === rows.length - 1}
              onClick={() => move(swap(ids, index, 1))}
            />
          </span>

          {children(row, index)}
        </li>
      ))}
    </ol>
  )
}
