import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ReorderableList } from './ReorderableList.tsx'

afterEach(cleanup)

const rows = [
  { id: 'a', name: 'Temple' },
  { id: 'b', name: 'Front Lawn' },
  { id: 'c', name: 'Kitchen' },
]

const show = (onReorder: (ids: string[]) => void, busy = false) =>
  render(
    <ReorderableList rows={rows} busy={busy} labelFor={(row) => row.name} onReorder={onReorder}>
      {(row) => <span>{row.name}</span>}
    </ReorderableList>,
  )

describe('the three ways to move a row', () => {
  it('sends the new order when a row is moved down', () => {
    const onReorder = vi.fn()
    show(onReorder)

    fireEvent.click(screen.getByRole('button', { name: 'Move Temple down' }))

    expect(onReorder).toHaveBeenCalledWith(['b', 'a', 'c'])
  })

  it('sends the new order when a row is moved up', () => {
    const onReorder = vi.fn()
    show(onReorder)

    fireEvent.click(screen.getByRole('button', { name: 'Move Kitchen up' }))

    expect(onReorder).toHaveBeenCalledWith(['a', 'c', 'b'])
  })

  it('moves with the arrow keys on the handle, for anybody not using a mouse', () => {
    const onReorder = vi.fn()
    show(onReorder)

    fireEvent.keyDown(screen.getByRole('button', { name: 'Move Front Lawn' }), { key: 'ArrowUp' })

    expect(onReorder).toHaveBeenCalledWith(['b', 'a', 'c'])
  })

  it('ignores a key that is not an arrow', () => {
    const onReorder = vi.fn()
    show(onReorder)

    fireEvent.keyDown(screen.getByRole('button', { name: 'Move Front Lawn' }), { key: 'Enter' })

    expect(onReorder).not.toHaveBeenCalled()
  })

  it('drops a dragged row where it was let go', () => {
    const onReorder = vi.fn()
    const { container } = show(onReorder)

    const handle = screen.getByRole('button', { name: 'Move Temple' })
    const target = container.querySelectorAll('li')[2]
    if (target === undefined) throw new Error('the third row is missing')

    fireEvent.dragStart(handle, { dataTransfer: { setData: vi.fn() } })
    fireEvent.drop(target)

    expect(onReorder).toHaveBeenCalledWith(['b', 'c', 'a'])
  })
})

describe('the ends of the list', () => {
  it('will not offer to move the first row up, or the last one down', () => {
    show(vi.fn())

    expect(screen.getByRole('button', { name: 'Move Temple up' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Move Kitchen down' })).toHaveProperty('disabled', true)
  })

  it('still offers the moves that exist', () => {
    show(vi.fn())

    expect(screen.getByRole('button', { name: 'Move Temple down' })).toHaveProperty('disabled', false)
    expect(screen.getByRole('button', { name: 'Move Kitchen up' })).toHaveProperty('disabled', false)
  })

  it('sends nothing when the end of the list is reached by keyboard', () => {
    const onReorder = vi.fn()
    show(onReorder)

    fireEvent.keyDown(screen.getByRole('button', { name: 'Move Temple' }), { key: 'ArrowUp' })

    expect(onReorder).not.toHaveBeenCalled()
  })
})

describe('while a move is in flight', () => {
  it('disables every control, so two reorders cannot race', () => {
    show(vi.fn(), true)

    expect(screen.getByRole('button', { name: 'Move Temple' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Move Temple down' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Move Kitchen up' })).toHaveProperty('disabled', true)
  })
})
