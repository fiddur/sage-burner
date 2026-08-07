import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { IconButton } from './IconButton.tsx'

afterEach(cleanup)

describe('a button whose face is an emoji', () => {
  it('is found by what it does, not by the emoji', () => {
    render(<IconButton icon="✏️" label="Edit Temple" />)

    expect(screen.getByRole('button', { name: 'Edit Temple' })).not.toBeNull()
  })

  it('still shows the emoji', () => {
    render(<IconButton icon="🗑️" label="Remove Temple" />)

    expect(screen.getByRole('button', { name: 'Remove Temple' }).textContent).toBe('🗑️')
  })

  it('calls back when pressed', () => {
    const onClick = vi.fn()
    render(<IconButton icon="✏️" label="Edit Temple" onClick={onClick} />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit Temple' }))

    expect(onClick).toHaveBeenCalled()
  })

  it('does not submit the form it sits in', () => {
    render(<IconButton icon="🗑️" label="Remove Temple" />)

    expect(screen.getByRole('button', { name: 'Remove Temple' }).getAttribute('type')).toBe('button')
  })

  it('can be disabled while something else is in flight', () => {
    render(<IconButton icon="✏️" label="Edit Temple" disabled />)

    expect(screen.getByRole('button', { name: 'Edit Temple' })).toHaveProperty('disabled', true)
  })
})
